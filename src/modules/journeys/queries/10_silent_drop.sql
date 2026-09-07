-- StarRocks. THE ONLY QUERY THAT SEES A PRE-COMMUNICATION FAILURE. Never skip it.
--
-- metadata is a JSON STRING: there is no "metadata.error" column, and querying that name
-- returns an EMPTY RESULT SET rather than an error — indistinguishable from a clean platform.
-- get_json_string must appear in all four places: select, both filters, and via the GROUP BY
-- ordinal.
--
-- status = 'failed' AND commlogId IS NULL is the definition of a silent drop: the customer
-- entered the step, the step failed, and nothing was ever sent.
SELECT journeyId,
       stepId,
       get_json_string(metadata, '$.error')                              AS error,
       count(*)                                                          AS customers,
       min(createdAt)                                                    AS first_seen,
       max(createdAt)                                                    AS last_seen
  FROM mongo_journeys.journeysteplogs
 WHERE createdAt >= :start AND createdAt < :end
   AND status = 'failed'
   AND commlogId IS NULL
   AND journeyId IN (:id_list)                        -- _id values from query 09
   AND get_json_string(metadata, '$.error') NOT IN (
         'Segment check delay',                        -- 612,735/day: engine backpressure
         'Promotional message can not be sent after 9 PM',  -- TRAI; creates a commlog row
         'A dlr node with no parent or grandparent communication node found')
   AND get_json_string(metadata, '$.error') NOT LIKE 'Variable not replaced:%'
 GROUP BY 1, 2, 3
 ORDER BY 4 DESC
 LIMIT 100
