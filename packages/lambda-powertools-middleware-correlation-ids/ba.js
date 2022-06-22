const consts = require("./consts");
const uuid = require("uuid");
const updateBARelatedCorrelationIds = (correlationIds) => {
  // BuyerAssist Logic to generate SpanIds/TraceIds
  let externalSource = ""
  if (correlationIds[consts.USER_AGENT] && correlationIds[consts.USER_AGENT].match(/zap/i)) {
    externalSource = "zap"
  }
  const spanId = generateSpanId(externalSource);
  if (!correlationIds[consts.X_CORRELATION_TRACE_ID]) {
    correlationIds[consts.X_CORRELATION_TRACE_ID] = generateTraceId(externalSource);
  }
  if (correlationIds[consts.X_CORRELATION_SPAN_ID]) {
    correlationIds[consts.X_CORRELATION_PARENT_ID] =
      correlationIds[consts.X_CORRELATION_SPAN_ID];
  }
  correlationIds[consts.X_CORRELATION_SPAN_ID] = spanId;
};
const generateTraceId = (externalSource) => {
  return `${externalSource}-${uuid.v1()}`;
};
const generateSpanId = (externalSource) => {
  return `${externalSource}-${uuid.v1()}-${process.env.SRV_DISPLAY_NAME}`;
};
module.exports = {
  updateBARelatedCorrelationIds,
};
