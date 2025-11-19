// Type declarations for @ax-llm/ax
// This file allows TypeScript to recognize the module even if not installed
// Install the actual package: npm install @ax-llm/ax

declare module "@ax-llm/ax" {
  export interface AIConfig {
    name: string;
    apiKey: string;
    model?: string;
  }

  export interface AxSignature {
    forward(llm: any, input: any): Promise<any>;
  }

  export function ai(config: AIConfig): any;
  export function ax(signature: string): AxSignature;
}

