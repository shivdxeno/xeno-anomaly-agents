-- StarRocks. The _id list query 10 needs — NOT oid__id, and there is no merchant_id on the
-- step logs, so ids are resolved here and filtered there. Never join.
SELECT _id, numericId, name, status
  FROM mongo_journeys.journeys
 WHERE merchantId IN (:merchant_ids)
