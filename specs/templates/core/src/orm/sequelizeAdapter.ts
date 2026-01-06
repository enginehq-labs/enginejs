import { DataTypes, type Model, type ModelStatic, type Sequelize } from 'sequelize';

import type { DslRoot } from '../dsl/types.js';
import { isDslModelSpec } from '../dsl/types.js';
import { DslConstraintError } from '../dsl/errors.js';
import type { OrmInitResult } from './types.js';

function stableIdentHash(input: unknown) {
  const s = String(input ?? '');
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return (h >>> 0).toString(36);
}

function mapType(type: string | undefined, length?: number) {
  const t = String(type || '').toLowerCase();
  switch (t) {
    case 'string':
      return DataTypes.STRING(length ?? 255);
    case 'text':
      return DataTypes.TEXT;
    case 'int':
    case 'integer':
      return DataTypes.INTEGER;
    case 'bigint':
      return DataTypes.BIGINT;
    case 'float':
    case 'decimal':
    case 'number':
      return DataTypes.DOUBLE;
    case 'boolean':
      return DataTypes.BOOLEAN;
    case 'date':
    case 'datetime':
      return DataTypes.DATE;
    case 'json':
    case 'jsonb':
      return DataTypes.JSONB;
    case 'uuid':
      return DataTypes.UUID;
    default:
      return DataTypes.STRING(length ?? 255);
  }
}

function isIntType(type: unknown) {
  const t = String(type || '').toLowerCase();
  return t === 'int' || t === 'integer' || t === 'bigint';
}

function isStringType(type: unknown) {
  return String(type || '').toLowerCase() === 'string';
}

export function initSequelizeModelsFromDsl(sequelize: Sequelize, dsl: DslRoot): OrmInitResult {
  const models: Record<string, ModelStatic<Model>> = {};
  const junctionModels: Record<string, ModelStatic<Model>> = {};

  const junctionDefs: Array<{
    owner: string;
    field: string;
    source: string;
    sourceid: string;
    unique: boolean;
    onDelete: string;
    onUpdate: string;
  }> = [];

  const modelKeys = Object.keys(dsl)
    .filter((k) => k !== '$schema')
    .sort((a, b) => a.localeCompare(b));

  for (const modelKey of modelKeys) {
    const spec = dsl[modelKey];
    if (!isDslModelSpec(spec)) continue;

    const tableName = spec.table || modelKey;
    const attrs: Record<string, any> = {};

    for (const [field, f] of Object.entries(spec.fields || {})) {
      if (f && typeof f === 'object' && (f as any).save === false) continue;

      const multi = (f as any)?.multi === true;
      const type = (f as any)?.type;
      const source = (f as any)?.source;
      const sourceid = (f as any)?.sourceid;
      const columnName = (f as any)?.columnName;

      if (multi && source && sourceid && isIntType(type)) {
        junctionDefs.push({
          owner: modelKey,
          field,
          source: String(source),
          sourceid: String(sourceid),
          unique: (f as any)?.unique === true,
          onDelete: (f as any)?.onDelete || 'RESTRICT',
          onUpdate: (f as any)?.onUpdate || 'CASCADE',
        });
        continue;
      }

      if (multi && isStringType(type)) {
        if (source || sourceid) {
          throw new DslConstraintError(
            `Invalid DSL: string multi fields cannot be foreign keys (${modelKey}.${field})`,
          );
        }
        attrs[field] = {
          type: DataTypes.ARRAY(DataTypes.STRING),
        };
        continue;
      }

      const dt = mapType(String(type || ''), (f as any)?.max || (f as any)?.length || (f as any)?.size);
      const a: any = { type: dt };
      if ((f as any)?.default !== undefined) a.defaultValue = (f as any).default;
      if ((f as any)?.primary === true) a.primaryKey = true;
      if ((f as any)?.autoIncrement === true && isIntType(type)) a.autoIncrement = true;

      if (columnName && columnName !== field) a.field = String(columnName);
      attrs[field] = a;
    }

    // Ensure an id exists (if not already defined).
    if (!('id' in attrs)) {
      attrs.id = { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true };
    }

    const model = sequelize.define(modelKey, attrs, {
      tableName,
      freezeTableName: true,
      underscored: false,
      timestamps: false,
    });

    models[modelKey] = model;
  }

  // belongsTo + reverse hasMany for scalar FKs
  for (const modelKey of modelKeys) {
    const spec = dsl[modelKey];
    if (!isDslModelSpec(spec)) continue;
    const m = models[modelKey];
    if (!m) continue;

    for (const [field, f] of Object.entries(spec.fields || {})) {
      if (f && typeof f === 'object' && (f as any).save === false) continue;

      const multi = (f as any)?.multi === true;
      const type = (f as any)?.type;
      const source = (f as any)?.source;
      const sourceid = (f as any)?.sourceid;
      if (!source || !sourceid) continue;
      if (multi && isIntType(type)) continue; // junction-backed

      const target = models[String(source)];
      if (!target) continue;

      const fk =
        (f as any)?.columnName != null
          ? { name: field, field: String((f as any).columnName) }
          : field;
      const alias = (f as any)?.as || String(source);
      const inverseAlias =
        typeof (f as any)?.inverseAs === 'string' && (f as any).inverseAs
          ? String((f as any).inverseAs)
          : modelKey;

      try {
        m.belongsTo(target, {
          as: alias,
          foreignKey: fk as any,
          targetKey: String(sourceid),
          onDelete: (f as any)?.onDelete || 'RESTRICT',
          onUpdate: (f as any)?.onUpdate || 'CASCADE',
        });
      } catch (_) {}

      try {
        const existing = (target as any).associations?.[inverseAlias];
        if (!existing) {
          target.hasMany(m, {
            as: inverseAlias,
            foreignKey: fk as any,
            sourceKey: String(sourceid),
            onDelete: (f as any)?.onDelete || 'RESTRICT',
            onUpdate: (f as any)?.onUpdate || 'CASCADE',
          });
        }
      } catch (_) {}
    }
  }

  // Junction models + belongsToMany convenience associations
  for (const def of junctionDefs) {
    const joinName = `${def.owner}__${def.field}__to__${def.source}__${def.sourceid}`;
    const joinHash = stableIdentHash(joinName);
    const ownerIdCol = `${def.owner}Id`;
    const sourceIdCol = `${def.source}Id`;

    const joinAttrs: Record<string, any> = {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      [ownerIdCol]: { type: DataTypes.INTEGER, allowNull: false },
      [sourceIdCol]: { type: DataTypes.INTEGER, allowNull: false },
      created_at: { type: DataTypes.DATE },
      updated_at: { type: DataTypes.DATE },
      deleted: { type: DataTypes.BOOLEAN, defaultValue: false },
      deleted_at: { type: DataTypes.DATE },
      archived: { type: DataTypes.BOOLEAN, defaultValue: false },
      archived_at: { type: DataTypes.DATE },
    };

    const indexes: any[] = [
      { name: `idx_${joinHash}_owner`, fields: [{ attribute: ownerIdCol }] },
      { name: `idx_${joinHash}_source`, fields: [{ attribute: sourceIdCol }] },
    ];
    if (def.unique) {
      indexes.push({
        name: `uq_${joinHash}_active`,
        unique: true,
        fields: [{ attribute: ownerIdCol }, { attribute: sourceIdCol }],
        where: { archived: false, deleted: false },
      });
    }

    const joinModel = sequelize.define(joinName, joinAttrs, {
      tableName: joinName,
      freezeTableName: true,
      underscored: false,
      timestamps: false,
      indexes,
    });

    junctionModels[joinName] = joinModel;
    models[joinName] = joinModel;

    const ownerModel = models[def.owner];
    const sourceModel = models[def.source];
    if (!ownerModel || !sourceModel) continue;

    // join -> source and join -> owner (not aliased; join model is internal)
    try {
      joinModel.belongsTo(sourceModel, {
        foreignKey: sourceIdCol,
        targetKey: def.sourceid,
        onDelete: def.onDelete,
        onUpdate: def.onUpdate,
      });
    } catch (_) {}

    try {
      joinModel.belongsTo(ownerModel, {
        foreignKey: ownerIdCol,
        targetKey: (ownerModel.primaryKeyAttributes?.[0] as string) || 'id',
        onDelete: def.onDelete,
        onUpdate: def.onUpdate,
      });
    } catch (_) {}

    // owner.field => array of sources
    try {
      ownerModel.belongsToMany(sourceModel, {
        through: joinModel,
        foreignKey: ownerIdCol,
        otherKey: sourceIdCol,
        as: def.field,
      });
    } catch (_) {}

    // inverse: source.owner => array of owners
    try {
      sourceModel.belongsToMany(ownerModel, {
        through: joinModel,
        foreignKey: sourceIdCol,
        otherKey: ownerIdCol,
        as: def.owner,
      });
    } catch (_) {}
  }

  return { sequelize, dsl, models, junctionModels };
}
