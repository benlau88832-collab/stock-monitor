// v9.84（分类统一）：共享词表类型声明（运行时数据在 concept-groups.js，前后端同源）
export interface ConceptGroupDef {
  /** 用户视角大类名（作战卡展示） */
  group: string;
  /** 覆盖该大类的词根（概念名 contains 任一即归属） */
  roots: string[];
}
export declare const CONCEPT_GROUPS: ConceptGroupDef[];
