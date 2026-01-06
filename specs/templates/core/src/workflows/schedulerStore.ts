import type { Model, ModelStatic } from 'sequelize';

export interface WorkflowSchedulerStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  setIfAbsent(key: string, value: string): Promise<boolean>;
}

export class InMemoryWorkflowSchedulerStore implements WorkflowSchedulerStore {
  private readonly kv = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.kv.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.kv.set(key, value);
  }

  async setIfAbsent(key: string, value: string): Promise<boolean> {
    if (this.kv.has(key)) return false;
    this.kv.set(key, value);
    return true;
  }
}

export class SequelizeWorkflowSchedulerStore implements WorkflowSchedulerStore {
  constructor(private readonly model: ModelStatic<Model>) {}

  async get(key: string): Promise<string | null> {
    const row = await (this.model as any).findOne({ where: { key }, raw: true });
    const v = row ? (row.value ?? null) : null;
    return v != null ? String(v) : null;
  }

  async set(key: string, value: string): Promise<void> {
    await (this.model as any).upsert({ key, value });
  }

  async setIfAbsent(key: string, value: string): Promise<boolean> {
    const existing = await (this.model as any).findOne({ where: { key }, raw: true });
    if (existing) return false;
    await (this.model as any).create({ key, value });
    return true;
  }
}

