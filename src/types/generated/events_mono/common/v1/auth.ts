/* eslint-disable */

export interface PublicApiAuth {
  account_id?: number | undefined
  organization_uuid?: string | undefined
  account_uuid?: string | undefined
}

export const PublicApiAuth = {
  fromJSON(object: any): PublicApiAuth {
    return object ?? {}
  },

  toJSON(message: PublicApiAuth): unknown {
    return message ?? {}
  },

  create<I extends PublicApiAuth>(base?: I): PublicApiAuth {
    return base ?? {}
  },

  fromPartial<I extends PublicApiAuth>(object: I): PublicApiAuth {
    return object ?? {}
  },
}
