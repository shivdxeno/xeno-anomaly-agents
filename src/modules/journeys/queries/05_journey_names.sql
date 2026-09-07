-- StarRocks. Identifiers are bare camelCase — the double-quote rule was Redshift's.
SELECT numericId, name, status, updatedAt
  FROM mongo_journeys.journeys
 WHERE merchantId IN (:merchant_ids)
