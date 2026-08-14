export interface ChainNode {
  name: string;
  keywords: string[];
}

export interface IndustryChain {
  id: string;
  name: string;
  nodes: ChainNode[];
}

export interface ChainView {
  chainId: string;
  chainName: string;
  boardName: string;
  nodeIdx: number;
  nodeName: string;
  nodes: string[];
  upstream: string[];
  downstream: string[];
  atHead: boolean;
  atTail: boolean;
}

export const CHAIN_KB: IndustryChain[];
export function locateChain(boardName: string): { chain: IndustryChain; nodeIdx: number } | null;
export function buildChainView(boardName: string, hops?: number): ChainView | null;
