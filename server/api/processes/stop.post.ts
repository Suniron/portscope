import { createError, defineEventHandler, getRequestHeader, readBody, setResponseHeader } from 'h3'
import { collectProcessSnapshot, getInventory, getObservedServices } from '../../utils/collector'
import { parseStopRequest, stopProcesses } from '../../utils/processes'
import { isAllowedMutation } from '../../utils/security'

export default defineEventHandler(async event => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  if (!isAllowedMutation(
    getRequestHeader(event, 'host'), getRequestHeader(event, 'origin'),
    getRequestHeader(event, 'content-type'), getRequestHeader(event, 'x-portscope-action')
  )) throw createError({ statusCode: 403, statusMessage: 'Only explicit same-origin JSON stop requests are allowed.' })
  let request
  try { request = parseStopRequest(await readBody(event)) }
  catch { throw createError({ statusCode: 400, statusMessage: 'Invalid stop request' }) }
  try {
    return await stopProcesses(request, getObservedServices(), {
      fresh: () => collectProcessSnapshot(AbortSignal.timeout(20000)),
      invalidate: () => getInventory.invalidate()
    })
  } catch {
    throw createError({ statusCode: 503, statusMessage: 'Inventory unavailable' })
  }
})
