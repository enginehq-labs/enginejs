export type SubjectConfig = {
  model: string;
  idClaims: string[];
};

export type RlsBypassConfig = {
  roles?: string[];
  claim?: string;
};

export type RlsConfig = {
  subjects: Record<string, SubjectConfig>;
  actorRoles?: { fromModel?: string; roleNameField?: string; roleIdField?: string };
  policies: Record<string, RlsModelPolicy>;
  bypass?: RlsBypassConfig;
};

export type RlsModelPolicy = {
  list?: RlsRuleSet;
  read?: RlsRuleSet;
  create?: RlsWriteRuleSet;
  update?: RlsWriteRuleSet;
  delete?: RlsWriteRuleSet;
};

export type RlsRuleSet =
  | { anyOf: RlsRuleSet[] }
  | { allOf: RlsRuleSet[] }
  | RlsRule;

export type RlsRule =
  | {
      subject: string;
      field: string;
    }
  | {
      subject: string;
      via: Array<{
        fromModel: string;
        fromField: string;
        toModel: string;
        toField: string;
      }>;
    }
  | {
      custom: string;
    };

export type RlsWriteRuleSet = RlsRuleSet & {
  writeMode?: 'enforce' | 'validate';
};

