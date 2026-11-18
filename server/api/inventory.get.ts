import { createError, defineEventHandler, setResponseHeader } from 'h3'
import { getInventory, observeInventory } from '../utils/collector'

export default defineEventHandler(async event => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  try {
    const inventory = await getInventory()
    observeInventory(inventory)
    return inventory
  } catch {
    throw createError({
      statusCode: 503,
      statusMessage: 'Inventory unavailable',
      message: 'Could not inspect local TCP listeners. Check that lsof (macOS/Linux) or ss (Linux) is installed and accessible. No elevated permissions are required.'
    })
  }
})
