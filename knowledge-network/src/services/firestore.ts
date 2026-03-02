/**
 * Firestore service layer for direct client-side reads.
 *
 * Write operations still go through the FastAPI backend.
 * This layer enables real-time listeners and fast reads for:
 *   - Knowledge graph nodes/edges
 *   - Student concept states (mastery)
 *   - Student profiles and blind-spot counts
 */

import { db } from "@/lib/firebase";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  orderBy,
  Unsubscribe,
} from "firebase/firestore";

// ── Types ────────────────────────────────────────────────────────────────────

export interface KnowledgeGraphNode {
  id: string;
  title: string;
  category: string;
  mastery_score: number;
  status: "mastered" | "learning" | "weak" | "not_started";
  careless_badge: boolean;
  decay_timestamp: string | null;
  attempt_count: number;
  correct_count: number;
  careless_count: number;
}

export interface KnowledgeGraphEdge {
  source: string;
  target: string;
  type: "prerequisite" | "related";
}

export interface ConceptState {
  concept_id: string;
  mastery: number;
  p_learn: number;
  p_guess: number;
  p_slip: number;
  decay_rate: number;
  last_updated: string;
  attempts: number;
  correct: number;
  careless_count: number;
}

export interface StudentProfile {
  blind_spot_counts: {
    found: number;
    resolved: number;
  };
}

export interface AttemptRecord {
  question_id: string;
  concept: string;
  is_correct: boolean;
  confidence_1_to_5: number;
  mistake_type: string | null;
  timestamp: string;
}

// ── Knowledge Graph ──────────────────────────────────────────────────────────

const GRAPH_ID = "default";

export async function getKnowledgeGraphNodes(): Promise<KnowledgeGraphNode[]> {
  const col = collection(db, "knowledge_graphs", GRAPH_ID, "concepts");
  const snapshot = await getDocs(col);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as KnowledgeGraphNode);
}

export async function getKnowledgeGraphEdges(): Promise<KnowledgeGraphEdge[]> {
  const col = collection(db, "knowledge_graphs", GRAPH_ID, "edges");
  const snapshot = await getDocs(col);
  return snapshot.docs.map((d) => d.data() as KnowledgeGraphEdge);
}

export async function getFullKnowledgeGraph(): Promise<{
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
}> {
  const [nodes, edges] = await Promise.all([
    getKnowledgeGraphNodes(),
    getKnowledgeGraphEdges(),
  ]);
  return { nodes, edges };
}

/** Real-time listener for knowledge graph concept changes. */
export function onKnowledgeGraphChange(
  callback: (nodes: KnowledgeGraphNode[]) => void
): Unsubscribe {
  const col = collection(db, "knowledge_graphs", GRAPH_ID, "concepts");
  return onSnapshot(col, (snapshot) => {
    const nodes = snapshot.docs.map(
      (d) => ({ id: d.id, ...d.data() }) as KnowledgeGraphNode
    );
    callback(nodes);
  });
}

// ── Student Concept States (BKT) ────────────────────────────────────────────

export async function getStudentConceptStates(
  studentId: string
): Promise<ConceptState[]> {
  const col = collection(db, "students", studentId, "concept_states");
  const snapshot = await getDocs(col);
  return snapshot.docs.map((d) => d.data() as ConceptState);
}

export async function getStudentConceptState(
  studentId: string,
  conceptId: string
): Promise<ConceptState | null> {
  const ref = doc(db, "students", studentId, "concept_states", conceptId);
  const snap = await getDoc(ref);
  return snap.exists() ? (snap.data() as ConceptState) : null;
}

/** Real-time listener for a student's mastery states. */
export function onConceptStatesChange(
  studentId: string,
  callback: (states: ConceptState[]) => void
): Unsubscribe {
  const col = collection(db, "students", studentId, "concept_states");
  return onSnapshot(col, (snapshot) => {
    callback(snapshot.docs.map((d) => d.data() as ConceptState));
  });
}

// ── Student Profile ──────────────────────────────────────────────────────────

export async function getStudentProfile(
  studentId: string
): Promise<StudentProfile | null> {
  const ref = doc(db, "students", studentId);
  const snap = await getDoc(ref);
  return snap.exists() ? (snap.data() as StudentProfile) : null;
}

// ── Attempt History ──────────────────────────────────────────────────────────

export async function getStudentAttempts(
  studentId: string
): Promise<AttemptRecord[]> {
  const col = collection(db, "students", studentId, "attempts");
  const q = query(col, orderBy("timestamp"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => d.data() as AttemptRecord);
}

/** Real-time listener for a student's attempt history. */
export function onAttemptsChange(
  studentId: string,
  callback: (attempts: AttemptRecord[]) => void
): Unsubscribe {
  const col = collection(db, "students", studentId, "attempts");
  const q = query(col, orderBy("timestamp"));
  return onSnapshot(q, (snapshot) => {
    callback(snapshot.docs.map((d) => d.data() as AttemptRecord));
  });
}
