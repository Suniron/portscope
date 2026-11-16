import { createError, defineEventHandler, getRequestHeader, setResponseHeader } from 'h3'
import { isAllowedRequest } from '../utils/security'

export default defineEventHandler(event => {
  if (!isAllowedRequest(getRequestHeader(event, 'host'), getRequestHeader(event, 'origin'))) {
    throw createError({ statusCode: 403, statusMessage: 'Only same-origin loopback requests are allowed.' })
  }
  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff')
  setResponseHeader(event, 'Referrer-Policy', 'no-referrer')
  setResponseHeader(event, 'Cross-Origin-Resource-Policy', 'same-origin')
  setResponseHeader(event, 'X-Frame-Options', 'DENY')
})
