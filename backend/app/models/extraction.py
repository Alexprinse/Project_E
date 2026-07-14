from typing import Any, Literal, Optional
from pydantic import BaseModel, Field


# ---------------------------------------------------------
# Node Entities Models
# ---------------------------------------------------------

class Equipment(BaseModel):
    tag: str = Field(..., description="Unique equipment tag, e.g., P-101A, V-202")
    type: Optional[str] = Field(None, description="Type of equipment, e.g., Centrifugal Pump, Control Valve")
    location: Optional[str] = Field(None, description="Location code or zone, e.g., Unit-3, Area-A")
    criticality: Optional[str] = Field(None, description="Criticality rating, e.g., High, Medium, Low")
    install_date: Optional[str] = Field(None, description="Installation date in YYYY-MM-DD format")
    oem: Optional[str] = Field(None, description="Original Equipment Manufacturer, e.g., Flowserve, Fisher")
    spec_ref: Optional[str] = Field(None, description="Reference specification ID or standard code")


class Document(BaseModel):
    id: str = Field(..., description="Unique document code or file ID, e.g., SOP-104, SPEC-990")
    type: Optional[str] = Field(None, description="Type of document, e.g., Operating Manual, Datasheet, P&ID")
    source_system: Optional[str] = Field(None, description="System from which it was fetched, e.g., Documentum, SharePoint")
    date: Optional[str] = Field(None, description="Document release or revision date")
    version: Optional[str] = Field(None, description="Version or revision string, e.g., Rev 3, v1.2")
    author: Optional[str] = Field(None, description="Author or issuing authority")


class Person(BaseModel):
    name: str = Field(..., description="Full name of the person")
    role: Optional[str] = Field(None, description="Job role, e.g., Maintenance Engineer, Operator")
    department: Optional[str] = Field(None, description="Department name, e.g., Operations, Reliability")
    certification: Optional[str] = Field(None, description="Professional certification, e.g., API 510, CMRP")


class Location(BaseModel):
    name: str = Field(..., description="Unique location or area name, e.g., Plant-1, Zone-B, Unit-4")
    plant: Optional[str] = Field(None, description="Plant name or refinery site")
    unit: Optional[str] = Field(None, description="Refinery unit designation, e.g., Crude Unit, FCCU")
    zone: Optional[str] = Field(None, description="Zone subdivision")


class ProcessParameter(BaseModel):
    name: str = Field(..., description="Parameter name, e.g., Discharge Pressure, Flow Rate")
    unit: Optional[str] = Field(None, description="Physical unit of measure, e.g., psi, gpm, C")
    normal_range_min: Optional[float] = Field(None, description="Lower bound of normal operating range")
    normal_range_max: Optional[float] = Field(None, description="Upper bound of normal operating range")


# Supporting schemas (defined for schema completeness, marked as TODO for later tracks)
class WorkOrder(BaseModel):
    id: str = Field(..., description="Work order number")
    date: Optional[str] = Field(None, description="Date of execution")
    type: Optional[str] = Field(None, description="Type, e.g., Preventive, Corrective")
    description: Optional[str] = Field(None, description="Summary of work performed")
    outcome: Optional[str] = Field(None, description="Outcome, e.g., Completed, Deferred")


class Failure(BaseModel):
    id: str = Field(..., description="Unique failure event ID")
    date: Optional[str] = Field(None, description="Failure occurrence date")
    severity: Optional[str] = Field(None, description="Severity rating, e.g., Critical, Minor")
    root_cause: Optional[str] = Field(None, description="Determined root cause")
    description: Optional[str] = Field(None, description="Detailed failure description")


class InspectionFinding(BaseModel):
    id: str = Field(..., description="Unique inspection log ID")
    date: Optional[str] = Field(None, description="Inspection date")
    result: Optional[str] = Field(None, description="Overall result, e.g., Pass, Fail")
    deviation: Optional[str] = Field(None, description="Identified deviation or thickness loss details")


class Procedure(BaseModel):
    id: str = Field(..., description="Unique procedure identifier")
    title: Optional[str] = Field(None, description="Procedure title")
    version: Optional[str] = Field(None, description="Procedure version number")


class Regulation(BaseModel):
    code: str = Field(..., description="Standard code regulation identifier, e.g., OSHA 1910.119")
    authority: Optional[str] = Field(None, description="Regulating authority, e.g., OSHA, ASME")
    clause: Optional[str] = Field(None, description="Clause number")
    requirement_text: Optional[str] = Field(None, description="Text of the requirement")


class NonConformance(BaseModel):
    id: str = Field(..., description="NCR unique reference number")
    date: Optional[str] = Field(None, description="Nonconformance report date")
    description: Optional[str] = Field(None, description="Report description")


# ---------------------------------------------------------
# Relationship Model
# ---------------------------------------------------------

class Relationship(BaseModel):
    source_id: str = Field(
        ...,
        description="Identifier of source node (e.g. tag for Equipment, name for Person, id for Document)"
    )
    source_label: Literal[
        "Equipment", "Document", "Person", "Location", "ProcessParameter",
        "WorkOrder", "Failure", "InspectionFinding", "Procedure", "Regulation",
        "NonConformance"
    ] = Field(..., description="Node label of the source entity")
    
    target_id: str = Field(
        ...,
        description="Identifier of target node (e.g. tag for Equipment, name for Person, id for Document)"
    )
    target_label: Literal[
        "Equipment", "Document", "Person", "Location", "ProcessParameter",
        "WorkOrder", "Failure", "InspectionFinding", "Procedure", "Regulation",
        "NonConformance"
    ] = Field(..., description="Node label of the target entity")
    
    type: Literal[
        "PART_OF", "HAS_DOCUMENT", "PERFORMED_ON", "PERFORMED_BY", "OCCURRED_ON",
        "LINKED_TO", "RELATES_TO", "APPLIES_TO", "GOVERNS"
    ] = Field(..., description="Cypher relationship link type")
    
    properties: dict[str, Any] = Field(
        default_factory=dict,
        description="Additional relationship attributes (e.g. function, system context)"
    )


# ---------------------------------------------------------
# Root Extraction Target
# ---------------------------------------------------------

class ExtractionResult(BaseModel):
    """Container grouping all validated entities and relationships extracted from a document segment."""
    equipments: list[Equipment] = Field(default_factory=list)
    documents: list[Document] = Field(default_factory=list)
    people: list[Person] = Field(default_factory=list)
    locations: list[Location] = Field(default_factory=list)
    process_parameters: list[ProcessParameter] = Field(default_factory=list)
    
    # Placeholders for future tracks, defined to maintain schema alignment
    work_orders: list[WorkOrder] = Field(default_factory=list)
    failures: list[Failure] = Field(default_factory=list)
    inspection_findings: list[InspectionFinding] = Field(default_factory=list)
    procedures: list[Procedure] = Field(default_factory=list)
    regulations: list[Regulation] = Field(default_factory=list)
    non_conformances: list[NonConformance] = Field(default_factory=list)
    
    relationships: list[Relationship] = Field(default_factory=list)
