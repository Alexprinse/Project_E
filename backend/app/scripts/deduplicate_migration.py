import os
import sys

# Add backend directory to path
sys.path.append("/Users/shalem/Documents/Project_E/backend")

from app.db.neo4j_connection import neo4j_service
from app.db.repositories.graph_repository import normalize_key

def get_pk_property(label: str) -> str:
    if label == "Equipment":
        return "tag"
    elif label in ["Person", "Location", "ProcessParameter"]:
        return "name"
    elif label == "Regulation":
        return "code"
    return "id"

def migrate():
    print("Connecting to Neo4j database...")
    neo4j_service.connect()
    session = neo4j_service.get_session()
    
    labels = ["Equipment", "Person", "Location", "ProcessParameter", "Regulation"]
    
    try:
        # Get total node count before migration
        before_count = session.run("MATCH (n) RETURN count(n) as count").single()["count"]
        print(f"Total nodes in database before migration: {before_count}")
        
        # Subgraph node counts
        for sub in ["dow", "chevron"]:
            cnt = session.run(
                "MATCH (n)-[:HAS_DOCUMENT|RELATES_TO]->(d:Document) WHERE d.name CONTAINS $sub RETURN count(n) as count",
                sub=sub
            ).single()["count"]
            print(f"- Subgraph {sub} nodes count before: {cnt}")

        for label in labels:
            pk_prop = get_pk_property(label)
            print(f"\nDeduplicating label: {label} (primary key: {pk_prop})...")
            
            # 1. Fetch all nodes of this label
            nodes_res = session.run(f"MATCH (n:{label}) RETURN elementId(n) as id, n as node")
            nodes_by_norm_key = {}
            
            for rec in nodes_res:
                node_id = rec["id"]
                node_props = dict(rec["node"])
                original_val = node_props.get(pk_prop)
                if not original_val:
                    continue
                
                norm_key = normalize_key(original_val)
                if norm_key not in nodes_by_norm_key:
                    nodes_by_norm_key[norm_key] = []
                nodes_by_norm_key[norm_key].append({
                    "id": node_id,
                    "original_val": original_val,
                    "props": node_props
                })
                
            for norm_key, group in nodes_by_norm_key.items():
                # Sort group: prioritize nodes that already have display_name or have more populated properties
                group.sort(key=lambda x: (len(x["props"]), "display_name" in x["props"]), reverse=True)
                
                canonical = group[0]
                duplicates = group[1:]
                
                # Update canonical node's primary key and display_name
                canonical_props = dict(canonical["props"])
                canonical_props[pk_prop] = norm_key
                if "display_name" not in canonical_props:
                    canonical_props["display_name"] = canonical["original_val"]
                
                # Write back canonical node updates
                session.run(
                    f"MATCH (n) WHERE elementId(n) = $id SET n = $props",
                    id=canonical["id"],
                    props=canonical_props
                )
                
                if duplicates:
                    print(f"  Merging {len(duplicates)} duplicates for key '{norm_key}' (canonical display: '{canonical_props['display_name']}')")
                    
                for dup in duplicates:
                    # Move outgoing relationships from duplicate to canonical
                    move_outgoing = f"""
                    MATCH (d) WHERE elementId(d) = $dup_id
                    MATCH (c) WHERE elementId(c) = $canonical_id
                    MATCH (d)-[r]->(target)
                    MERGE (c)-[new_r:TYPE_PLACEHOLDER]->(target)
                    ON CREATE SET new_r = properties(r)
                    """
                    # We need to dynamically handle relationship type in Cypher or run one by one
                    # Find all outgoing rels
                    out_rels = session.run(
                        "MATCH (d)-[r]->(target) WHERE elementId(d) = $dup_id RETURN type(r) as type, elementId(target) as target_id, properties(r) as props",
                        dup_id=dup["id"]
                    )
                    for rel in out_rels:
                        session.run(
                            f"""
                            MATCH (c) WHERE elementId(c) = $canonical_id
                            MATCH (target) WHERE elementId(target) = $target_id
                            MERGE (c)-[new_r:`{rel['type']}`]->(target)
                            ON CREATE SET new_r = $props
                            """,
                            canonical_id=canonical["id"],
                            target_id=rel["target_id"],
                            props=rel["props"]
                        )
                        
                    # Find all incoming rels
                    in_rels = session.run(
                        "MATCH (source)-[r]->(d) WHERE elementId(d) = $dup_id RETURN type(r) as type, elementId(source) as source_id, properties(r) as props",
                        dup_id=dup["id"]
                    )
                    for rel in in_rels:
                        session.run(
                            f"""
                            MATCH (source) WHERE elementId(source) = $source_id
                            MATCH (c) WHERE elementId(c) = $canonical_id
                            MERGE (source)-[new_r:`{rel['type']}`]->(c)
                            ON CREATE SET new_r = $props
                            """,
                            source_id=rel["source_id"],
                            canonical_id=canonical["id"],
                            props=rel["props"]
                        )
                        
                    # Delete the duplicate node
                    session.run(
                        "MATCH (d) WHERE elementId(d) = $dup_id DETACH DELETE d",
                        dup_id=dup["id"]
                    )
                    
        # Get total node count after migration
        after_count = session.run("MATCH (n) RETURN count(n) as count").single()["count"]
        print(f"\nTotal nodes in database after migration: {after_count}")
        
        # Subgraph node counts after
        for sub in ["dow", "chevron"]:
            cnt = session.run(
                "MATCH (n)-[:HAS_DOCUMENT|RELATES_TO]->(d:Document) WHERE d.name CONTAINS $sub RETURN count(n) as count",
                sub=sub
            ).single()["count"]
            print(f"- Subgraph {sub} nodes count after: {cnt}")
            
    finally:
        session.close()
        neo4j_service.close()

if __name__ == "__main__":
    migrate()
