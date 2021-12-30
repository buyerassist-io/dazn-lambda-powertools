const _ = require("lodash");
const uuid = require("uuid/v4");
const middy = require("@middy/core");
const CorrelationIds = require("@buyerassist/dazn-lambda-powertools-correlation-ids");
const captureCorrelationIds = require("../index");

global.console.log = jest.fn();

const invokeFirehoseHandler = async (
  event,
  awsRequestId,
  sampleDebugLogRate,
  handlerF,
  recordF
) => {
  const handler = middy(async (event, context) => {
    // check the correlation IDs outside the context of a record are correct
    handlerF(CorrelationIds.get());

    context.parsedFirehoseEvents.forEach((evt) => {
      recordF(evt);
    });

    // check the correlation IDs outside the context of a record are correct
    handlerF(CorrelationIds.get());
  });
  handler.use(captureCorrelationIds({ sampleDebugLogRate }));

  await handler(event, { awsRequestId });
};

const firehose = require("./event-templates/firehose.json");
const genFirehoseEvent = (correlationIDs = {}) => {
  const event = _.cloneDeep(firehose);

  const data = {
    type: "test",
    __context__: correlationIDs,
  };

  const record = event.records[0];
  record.data = Buffer.from(JSON.stringify(data)).toString("base64");

  return event;
};

const genFirehoseEventWithoutJSON = (correlationIDs = {}) => {
  return _.cloneDeep(firehose);
};

const firehoseTests = () => {
  describe("when sampleDebugLogRate = 0", () => {
    it("always sets debug-log-enabled to false", async () => {
      const requestId = uuid();
      await invokeFirehoseHandler(
        genFirehoseEvent(),
        requestId,
        0,
        (x) => {
          expect(x["awsRequestId"]).toBe(requestId);
          expect(x["debug-log-enabled"]).toBe("false");
        },
        (record) => {
          const x = record.correlationIds.get();
          expect(x["awsRequestId"]).toBe(requestId);
          expect(x["debug-log-enabled"]).toBe("false");
        }
      );
    });
  });

  describe("when event lacks JSON payload", () => {
    it("should ignore the event", async () => {
      const requestId = uuid();
      await invokeFirehoseHandler(
        genFirehoseEventWithoutJSON(),
        requestId,
        0,
        (x) => {
          expect(x["awsRequestId"]).toBe(requestId);
          expect(x["debug-log-enabled"]).toBe("false");
        },
        (parsedRecord) => {
          // We didn't parse any records as they were json.
          expect(parsedRecord).toBeUndefined();
        }
      );
    });
  });

  describe("when sampleDebugLogRate = 1", () => {
    it("always sets debug-log-enabled to true", async () => {
      const requestId = uuid();
      await invokeFirehoseHandler(
        genFirehoseEvent(),
        requestId,
        1,
        (x) => {
          expect(x["awsRequestId"]).toBe(requestId);
          expect(x["debug-log-enabled"]).toBe("true");
        },
        (record) => {
          const x = record.correlationIds.get();
          expect(x["awsRequestId"]).toBe(requestId);
          expect(x["debug-log-enabled"]).toBe("true");
        }
      );
    });
  });

  describe("when correlation ID is not provided in the event", () => {
    it("sets it to the AWS Request ID", async () => {
      const requestId = uuid();
      await invokeFirehoseHandler(
        genFirehoseEvent(),
        requestId,
        0,
        (x) => {
          // correlation IDs at the handler level
          expect(x["x-correlation-id"]).toBe(requestId);
          expect(x["awsRequestId"]).toBe(requestId);
        },
        (record) => {
          const x = record.correlationIds.get();
          // correlation IDs at the record level should just take from the handler
          expect(x["x-correlation-id"]).toBe(requestId);
          expect(x["awsRequestId"]).toBe(requestId);
        }
      );
    });
  });

  describe("when call-chain-length is not provided in the event", () => {
    it("sets it to 1", async () => {
      const requestId = uuid();
      await invokeFirehoseHandler(
        genFirehoseEvent(),
        requestId,
        0,
        (x) => {}, // n/a
        (record) => {
          const x = record.correlationIds.get();
          expect(x["call-chain-length"]).toBe(1);
        }
      );
    });
  });

  describe("when correlation IDs are provided in the event", () => {
    let handlerCorrelationIds;
    let record;
    let id;
    let userId;
    let requestId;

    beforeEach(async () => {
      id = uuid();
      userId = uuid();

      const correlationIds = {
        "x-correlation-id": id,
        "x-correlation-user-id": userId,
        "User-Agent": "jest test",
        "debug-log-enabled": "true",
      };

      const event = genFirehoseEvent(correlationIds);
      requestId = uuid();
      await invokeFirehoseHandler(
        event,
        requestId,
        0,
        (x) => {
          handlerCorrelationIds = x;
        },
        (aRecord) => {
          record = aRecord;
        }
      );
    });

    it("still has the correct handler correlation IDs", () => {
      expect(handlerCorrelationIds["x-correlation-id"]).toBe(requestId);
      expect(handlerCorrelationIds["awsRequestId"]).toBe(requestId);
    });

    it("captures them on the record", () => {
      const x = record.correlationIds.get();
      // correlation IDs at the record level should match what was passed in
      expect(x["x-correlation-id"]).toBe(id);
      expect(x["x-correlation-user-id"]).toBe(userId);
      expect(x["User-Agent"]).toBe("jest test");
      expect(x["debug-log-enabled"]).toBe("true");
      expect(x["awsRequestId"]).toBe(requestId);
    });

    it("sets correlationIds as a non-enumerable property", () => {
      expect(record).toHaveProperty("correlationIds");
      expect(record.propertyIsEnumerable("correlationIds")).toBe(false);
    });

    it("sets logger as a non-enumerable property", () => {
      expect(record).toHaveProperty("logger");
      expect(record.propertyIsEnumerable("logger")).toBe(false);
      expect(record.logger.correlationIds).toBe(record.correlationIds);
    });
  });

  describe("when correlation IDs are provided in the event", () => {
    let record;
    let id;

    beforeEach(async () => {
      id = uuid();

      const correlationIds = {
        "x-correlation-id": id,
        "call-chain-length": 1,
      };

      const event = genFirehoseEvent(correlationIds);
      await invokeFirehoseHandler(
        event,
        uuid(),
        0,
        () => {},
        (aRecord) => {
          record = aRecord;
        }
      );
    });

    it("increments it by 1", () => {
      const x = record.correlationIds.get();
      expect(x["call-chain-length"]).toBe(2);
    });
  });
};

describe("Correlation IDs middleware (Firehose)", () => {
  firehoseTests();
});
