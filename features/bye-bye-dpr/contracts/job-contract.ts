import { z } from "zod"
import { geoPointSchema } from "@/features/bye-bye-dpr/contracts/clock-contract"

export const nearestJobRequestSchema = z.object({
  location: geoPointSchema,
})
export type NearestJobRequest = z.infer<typeof nearestJobRequestSchema>

export const createJobRequestSchema = z.object({
  name: z.string().min(1).max(200),
  address: z.string().max(500).nullish(),
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
  directoryContextId: z.string().max(200).nullish(),
  notifyUserIds: z.array(z.string()).max(500).nullish(),
})
export type CreateJobRequest = z.infer<typeof createJobRequestSchema>
