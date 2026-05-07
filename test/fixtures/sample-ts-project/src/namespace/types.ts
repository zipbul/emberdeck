/** @brief domain/types */
export namespace Types {
  export interface Identifiable {
    id: string;
  }

  export interface Timestamped {
    createdAt: Date;
    updatedAt: Date;
  }

  export type Entity = Identifiable & Timestamped;
}

export const VERSION = '1.0.0';

export type StringOrNumber = string | number;
