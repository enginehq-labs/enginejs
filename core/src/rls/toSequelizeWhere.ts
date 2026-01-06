import type { Model, ModelStatic, Sequelize } from 'sequelize';

import type { OrmInitResult } from '../orm/types.js';
import type { RlsWhere } from './where.js';

function getSequelizeLib(orm: OrmInitResult) {
  const Seq = (orm.sequelize as any).Sequelize ?? (orm.sequelize as any).constructor;
  const Op = (Seq as any).Op;
  return {
    Op,
    literal: (Seq as any).literal.bind(Seq),
  };
}

function getTableName(model: ModelStatic<Model>): string {
  const tn = (model as any).getTableName?.();
  if (typeof tn === 'string') return tn;
  if (tn && typeof tn === 'object' && (tn as any).tableName) return String((tn as any).tableName);
  return String((model as any).name || 'unknown');
}

function pkAttr(model: ModelStatic<Model>): string {
  const pk = (model as any).primaryKeyAttributes?.[0];
  return String(pk || 'id');
}

function colName(model: ModelStatic<Model>, attrOrCol: string): string {
  const attrs = (model as any).rawAttributes || {};
  const a = attrs[attrOrCol];
  if (a && typeof a === 'object' && a.field) return String(a.field);
  return String(attrOrCol);
}

function hasActiveFlags(model: ModelStatic<Model>): { deleted: boolean; archived: boolean } {
  const attrs = (model as any).rawAttributes || {};
  return { deleted: !!attrs.deleted, archived: !!attrs.archived };
}

function viaToSequelize({
  orm,
  rootModelKey,
  subjectId,
  chain,
}: {
  orm: OrmInitResult;
  rootModelKey: string;
  subjectId: string | number;
  chain: Array<{ fromModel: string; fromField: string; toModel: string; toField: string }>;
}) {
  const { Op, literal } = getSequelizeLib(orm);
  const rootModel = (orm.models as any)[rootModelKey] as ModelStatic<Model> | undefined;
  if (!rootModel) return null;

  const rootAlias = 't0';
  const rootTable = getTableName(rootModel);
  const rootPkAttr = pkAttr(rootModel);
  const rootPkCol = colName(rootModel, rootPkAttr);

  const aliases: Array<{ modelKey: string; alias: string; model: ModelStatic<Model> }> = [{ modelKey: rootModelKey, alias: rootAlias, model: rootModel }];

  // Validate chain starts at root and is sequential.
  for (let i = 0; i < chain.length; i++) {
    const step = chain[i]!;
    const prev = aliases[i]!;
    if (String(step.fromModel) !== prev.modelKey) return null;
    const nextKey = String(step.toModel);
    const nextModel = (orm.models as any)[nextKey] as ModelStatic<Model> | undefined;
    if (!nextModel) return null;
    aliases.push({ modelKey: nextKey, alias: `t${i + 1}`, model: nextModel });
  }

  const parts: string[] = [];
  parts.push(`SELECT "${rootAlias}"."${rootPkCol}" FROM "${rootTable}" AS "${rootAlias}"`);

  for (let i = 0; i < chain.length; i++) {
    const step = chain[i]!;
    const from = aliases[i]!;
    const to = aliases[i + 1]!;
    const fromCol = colName(from.model, String(step.fromField));
    const toCol = colName(to.model, String(step.toField));
    const toTable = getTableName(to.model);
    parts.push(`JOIN "${toTable}" AS "${to.alias}" ON "${from.alias}"."${fromCol}" = "${to.alias}"."${toCol}"`);
  }

  const where: string[] = [];
  for (const a of aliases) {
    const flags = hasActiveFlags(a.model);
    if (flags.deleted) where.push(`"${a.alias}"."deleted" = false`);
    if (flags.archived) where.push(`"${a.alias}"."archived" = false`);
  }

  const last = chain[chain.length - 1]!;
  const lastAlias = aliases[aliases.length - 1]!;
  const lastToCol = colName(lastAlias.model, String(last.toField));
  where.push(`"${lastAlias.alias}"."${lastToCol}" = ${(orm.sequelize as any).escape(subjectId)}`);

  if (where.length) parts.push(`WHERE ${where.join(' AND ')}`);

  const sub = parts.join(' ');
  return { [rootPkAttr]: { [Op.in]: literal(`(${sub})`) } };
}

export function rlsWhereToSequelize(orm: OrmInitResult, modelKey: string, where: RlsWhere | null | undefined): any {
  if (!where) return null;
  const { Op } = getSequelizeLib(orm);
  if ((where as any).eq) return { [String((where as any).eq.field)]: (where as any).eq.value };
  if ((where as any).via) {
    const v = (where as any).via;
    return viaToSequelize({ orm, rootModelKey: modelKey, subjectId: v.subjectId, chain: v.chain });
  }
  if ((where as any).and) return { [Op.and]: ((where as any).and as any[]).map((x) => rlsWhereToSequelize(orm, modelKey, x)).filter(Boolean) };
  if ((where as any).or) return { [Op.or]: ((where as any).or as any[]).map((x) => rlsWhereToSequelize(orm, modelKey, x)).filter(Boolean) };
  return null;
}
