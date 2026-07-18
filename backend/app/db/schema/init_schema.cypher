// Unique Constraints for Entities
CREATE CONSTRAINT equipment_tag_unique IF NOT EXISTS FOR (e:Equipment) REQUIRE e.tag IS UNIQUE;
CREATE CONSTRAINT document_id_unique IF NOT EXISTS FOR (d:Document) REQUIRE d.id IS UNIQUE;
CREATE CONSTRAINT person_name_unique IF NOT EXISTS FOR (p:Person) REQUIRE p.name IS UNIQUE;
CREATE CONSTRAINT location_name_unique IF NOT EXISTS FOR (l:Location) REQUIRE l.name IS UNIQUE;
CREATE CONSTRAINT processparameter_name_unique IF NOT EXISTS FOR (p:ProcessParameter) REQUIRE p.name IS UNIQUE;
CREATE CONSTRAINT workorder_id_unique IF NOT EXISTS FOR (w:WorkOrder) REQUIRE w.id IS UNIQUE;
CREATE CONSTRAINT failure_id_unique IF NOT EXISTS FOR (f:Failure) REQUIRE f.id IS UNIQUE;
CREATE CONSTRAINT inspectionfinding_id_unique IF NOT EXISTS FOR (i:InspectionFinding) REQUIRE i.id IS UNIQUE;
CREATE CONSTRAINT procedure_id_unique IF NOT EXISTS FOR (p:Procedure) REQUIRE p.id IS UNIQUE;
CREATE CONSTRAINT regulation_code_unique IF NOT EXISTS FOR (r:Regulation) REQUIRE r.code IS UNIQUE;
CREATE CONSTRAINT nonconformance_id_unique IF NOT EXISTS FOR (n:NonConformance) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT chunk_id_unique IF NOT EXISTS FOR (c:Chunk) REQUIRE c.id IS UNIQUE;
CREATE CONSTRAINT ingestionjob_id_unique IF NOT EXISTS FOR (j:IngestionJob) REQUIRE j.id IS UNIQUE;

// QueryLog is a structurally-isolated audit trail of past Copilot/RCA queries and answers -
// it carries NO relationships to the knowledge graph and must never be treated as an entity.
CREATE CONSTRAINT querylog_id_unique IF NOT EXISTS FOR (q:QueryLog) REQUIRE q.id IS UNIQUE;

// Vector Index on Document Chunk Embeddings (Voyage-3 default 1024 dimensions)
CREATE VECTOR INDEX chunk_embeddings IF NOT EXISTS
FOR (c:Chunk) ON (c.embedding)
OPTIONS {
  indexConfig: {
    `vector.dimensions`: 1024,
    `vector.similarity_function`: 'cosine'
  }
};

// Full-text indexes for fallback keyword search
CREATE FULLTEXT INDEX equipment_tag_fulltext IF NOT EXISTS
FOR (e:Equipment) ON EACH [e.tag, e.display_name];

CREATE FULLTEXT INDEX document_properties_fulltext IF NOT EXISTS
FOR (d:Document) ON EACH [d.id, d.name, d.type, d.source_system, d.author];
