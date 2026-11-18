import { createError, defineEventHandler, getRequestHeader, readBody, setResponseHeader } from 'h3'
import { getObservedServices } from '../../utils/collector'
import { openProcess, parseOpenRequest, ProcessOpenError } from '../../utils/processes'
import { isAllowedMutation } from '../../utils/security'

export default defineEventHandler(async event => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  if (!isAllowedMutation(
    getRequestHeader(event, 'host'), getRequestHeader(event, 'origin'),
    getRequestHeader(event, 'content-type'), getRequestHeader(event, 'x-portscope-action'), 'open'
  )) throw createError({ statusCode: 403, statusMessage: 'Only explicit same-origin JSON open requests are allowed.' })
  let request
  try { request = parseOpenRequest(await readBody(event)) }
  catch { throw createError({ statusCode: 400, statusMessage: 'Invalid open request' }) }
  try {
    return await openProcess(request, getObservedServices())
  } catch (error) {
    if (error instanceof ProcessOpenError) throw createError({ statusCode: error.statusCode, statusMessage: error.message })
    throw createError({ statusCode: 503, statusMessage: 'Could not open the directory.' })
  }
})
