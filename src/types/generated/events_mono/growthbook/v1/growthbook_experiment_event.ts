/* eslint-disable */

import type { PublicApiAuth } from '../../common/v1/auth.js'

export interface GrowthbookExperimentEvent {
  event_id?: string | undefined
  timestamp?: Date | undefined
  experiment_id?: string | undefined
  variation_id?: number | undefined
  environment?: string | undefined
  user_attributes?: string | undefined
  experiment_metadata?: string | undefined
  device_id?: string | undefined
  auth?: PublicApiAuth | undefined
  session_id?: string | undefined
  anonymous_id?: string | undefined
  event_metadata_vars?: string | undefined
}

export const GrowthbookExperimentEvent = {
  fromJSON(object: any): GrowthbookExperimentEvent {
    return object ?? {}
  },

  toJSON(message: GrowthbookExperimentEvent): unknown {
    return message ?? {}
  },

  create<I extends GrowthbookExperimentEvent>(
    base?: I,
  ): GrowthbookExperimentEvent {
    return base ?? {}
  },

  fromPartial<I extends GrowthbookExperimentEvent>(
    object: I,
  ): GrowthbookExperimentEvent {
    return object ?? {}
  },
}
