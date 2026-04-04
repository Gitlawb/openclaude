/* eslint-disable */

export const Timestamp = {
  fromJSON(object: any): any {
    return object
  },

  toJSON(message: any): unknown {
    return message ?? {}
  },

  create<T>(base?: T): T | {} {
    return base ?? {}
  },

  fromPartial<T>(object: T): T {
    return object
  },
}
