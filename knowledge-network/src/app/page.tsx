'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Card } from "@/components/ui/card";
import { BookOpen, AlertTriangle, Target, Maximize2, Minimize2, X, ArrowRight, Sparkles, ShieldCheck, Upload, Folder, FileText, ChevronDown, ChevronRight, Pencil, Trash2, Plus, Loader2 } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import KnowledgeGraph from '@/components/graphs/KnowledgeGraph';
import { useStudentId } from '@/hooks/useStudentId';
import { useAuth } from '@/contexts/AuthContext';
import { useSidebar } from '@/contexts/SidebarContext';
import { CourseOption, DEFAULT_COURSES } from '@/lib/courses';
import { useAuthedApi } from '@/hooks/useAuthedApi';
import { GlowingEffect } from '@/components/ui/glowing-effect';
import { normalizeTopicRow, TopicOption, UserTopicApiRow } from '@/types/topics';

interface KGNode {
  id: string;
  title: string;
  mastery: number;
  status: 'mastered' | 'learning' | 'weak' | 'not_started';
  courseId?: string;
  topicIds?: string[];
  category?: string;
  decayTimestamp?: string | null;
}

interface KGLink {
  source: string;
  target: string;
  type: 'prerequisite' | 'related';
}

interface StudentProgress {
  student_id: string;
  total_attempts: number;
  correct_attempts: number;
  accuracy: number;
  careless_count: number;
  conceptual_count: number;
  blind_spots: { found: number; resolved: number };
  self_awareness: { score: number; calibration_gap: number; total_attempts: number };
  concept_mastery: { concept_id: string; mastery: number; attempts: number; correct: number; careless_count: number; last_updated: string | null }[];
  recent_attempts: any[];
  kg_stats: { total_concepts: number; mastered: number; learning: number; weak: number; not_started: number };
}

interface AIRecommendation {
  concept_id: string;
  title: string;
  summary: string;
  reasons: string[];
  confidence: 'high' | 'medium' | 'low';
  disclaimer: string;
  provider?: string;
  model: string;
}

interface CourseTopicGroup {
  id: string;
  name: string;
  topics: TopicOption[];
}

function formatLearningStatus(status: KGNode['status']) {
  switch (status) {
    case 'weak':
      return 'Needs work';
    case 'learning':
      return 'In progress';
    case 'mastered':
      return 'Strong';
    case 'not_started':
    default:
      return 'Not started';
  }
}

function formatConfidenceLabel(confidence: AIRecommendation['confidence']) {
  switch (confidence) {
    case 'high':
      return 'Strong signal';
    case 'medium':
      return 'Moderate signal';
    case 'low':
    default:
      return 'Early signal';
  }
}

function humanizeRecommendationReason(reason: string) {
  const trimmed = reason.replace(/_/g, ' ').trim();
  if (!trimmed) return trimmed;

  const dynamicRewrites: Array<[RegExp, (full: string, ...groups: string[]) => string]> = [
    [
      /mastery is ([\d.]+)%?,? the lowest in the candidate set, making it the most urgent gap\.?/i,
      (_full, value) =>
        `Your current understanding is ${Math.round(Number(value))}%, which makes this the most urgent topic to revisit right now.`,
    ],
    [
      /it has ?decay is true, indicating forgetting risk is already visible\.?/i,
      () => 'This topic is due for review, so waiting longer could make it harder to remember.',
    ],
    [
      /it is also showing review decay, so delaying it increases forgetting risk\.?/i,
      () => 'This topic is due for review, so waiting longer could make it harder to remember.',
    ],
    [
      /unlock count is (\d+), so improving this can unblock at least one downstream topic\.?/i,
      (_full, value) =>
        `Improving this now can help with ${value} connected topic${Number(value) === 1 ? '' : 's'} that come next.`,
    ],
    [
      /prerequisite count is 0, so you can address it immediately without needing other refreshers first\.?/i,
      () => 'You can work on this right away without needing to review another topic first.',
    ],
    [
      /prerequisite count is (\d+), so you can address it immediately without needing other refreshers first\.?/i,
      (_full, value) =>
        `It builds on ${value} earlier topic${Number(value) === 1 ? '' : 's'}, so strengthening it now can prevent confusion from stacking up.`,
    ],
  ];

  let next = trimmed;
  for (const [pattern, replacer] of dynamicRewrites) {
    if (pattern.test(next)) {
      next = next.replace(pattern, (...args) => replacer(String(args[0]), ...args.slice(1, -2).map(String)));
    }
  }

  return next
    .replace(/\bhas decay\b/gi, 'is due for review')
    .replace(/\bhas_decay\b/gi, 'is due for review')
    .replace(/\bunlock_count\b/gi, 'connected topics')
    .replace(/\bprerequisite_count\b/gi, 'earlier topics')
    .replace(/\bcandidate set\b/gi, 'current options')
    .replace(/\bdownstream\b/gi, 'later')
    .replace(/\s+/g, ' ')
    .trim();
}

export default function Page() {
  const [nodes, setNodes] = useState<KGNode[]>([]);
  const [links, setLinks] = useState<KGLink[]>([]);
  const [progress, setProgress] = useState<StudentProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [courses, setCourses] = useState<CourseOption[]>([{ id: 'all', name: 'All Courses' }, ...DEFAULT_COURSES]);
  const [topics, setTopics] = useState<TopicOption[]>([]);
  const [selectedCourse, setSelectedCourse] = useState('all');
  const [selectedTopic, setSelectedTopic] = useState<string>('all');
  const [isKGExpanded, setIsKGExpanded] = useState(false);
  const [isNeedsAttentionOpen, setIsNeedsAttentionOpen] = useState(false);
  const [isActivityOpen, setIsActivityOpen] = useState(false);
  const [isCourseProgressOpen, setIsCourseProgressOpen] = useState(false);
  const [isCourseTopicManagerOpen, setIsCourseTopicManagerOpen] = useState(false);
  const [expandedManagerCourses, setExpandedManagerCourses] = useState<Set<string>>(new Set());
  const [renamingCourseId, setRenamingCourseId] = useState<string | null>(null);
  const [renamingCourseName, setRenamingCourseName] = useState('');
  const [savingCourseId, setSavingCourseId] = useState<string | null>(null);
  const [renamingTopicKey, setRenamingTopicKey] = useState<string | null>(null);
  const [renamingTopicName, setRenamingTopicName] = useState('');
  const [savingTopicKey, setSavingTopicKey] = useState<string | null>(null);
  const [courseTopicManagerError, setCourseTopicManagerError] = useState<string | null>(null);
  const [addingCourseInput, setAddingCourseInput] = useState('');
  const [savingNewCourse, setSavingNewCourse] = useState(false);
  const [addingTopicForCourseId, setAddingTopicForCourseId] = useState<string | null>(null);
  const [addingTopicInput, setAddingTopicInput] = useState('');
  const [savingNewTopic, setSavingNewTopic] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<
    | { type: 'course'; courseId: string; courseName: string }
    | { type: 'topic'; topic: TopicOption }
    | null
  >(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showMapLabels, setShowMapLabels] = useState(false);
  const [actionCourse, setActionCourse] = useState('all');
  const [loadWarning, setLoadWarning] = useState<string | null>(null);
  const [aiRecommendation, setAiRecommendation] = useState<AIRecommendation | null>(null);
  const [recommendationSource, setRecommendationSource] = useState<'backend-ai' | 'heuristic'>('heuristic');
  const [recommendationPending, setRecommendationPending] = useState(false);
  const studentId = useStudentId();
  const { user, getIdToken } = useAuth();
  const { setIsCollapsed } = useSidebar();
  const { apiFetchWithAuth } = useAuthedApi();

  const toggleKG = () => {
    const next = !isKGExpanded;
    setIsKGExpanded(next);
    setIsCollapsed(next);
  };

  const displayName = user?.displayName || user?.email?.split('@')[0] || 'Student';

  useEffect(() => {
    async function loadData() {
      setLoadWarning(null);
      try {
        const [graphResult, courseResult, progressResult, topicResult] = await Promise.allSettled([
          apiFetchWithAuth<{ nodes: KGNode[]; links: KGLink[] }>('/api/kg/graph'),
          apiFetchWithAuth<{ courses: CourseOption[] }>('/api/courses'),
          apiFetchWithAuth<StudentProgress>(`/api/students/${studentId}/progress`),
          apiFetchWithAuth<{ topics?: UserTopicApiRow[] }>('/api/user-topics'),
        ]);

        const graphData =
          graphResult.status === 'fulfilled'
            ? graphResult.value
            : { nodes: [], links: [] };
        const courseData =
          courseResult.status === 'fulfilled'
            ? courseResult.value
            : { courses: DEFAULT_COURSES };
        const progressData =
          progressResult.status === 'fulfilled'
            ? progressResult.value
            : null;
        const topicRows =
          topicResult.status === 'fulfilled' && Array.isArray(topicResult.value.topics)
            ? topicResult.value.topics
            : [];

        if (graphResult.status === 'rejected') {
          setLoadWarning(
            'Live recommendation data could not be fully refreshed. Mentora is showing a reduced dashboard until the graph service is back.'
          );
        } else if (courseResult.status === 'rejected' || progressResult.status === 'rejected') {
          setLoadWarning(
            'Some live metrics are temporarily unavailable, but your current recommendations still use the latest graph signals we have.'
          );
        }

        const incoming: CourseOption[] = Array.isArray(courseData.courses) ? courseData.courses : DEFAULT_COURSES;
        setCourses([{ id: 'all', name: 'All Courses' }, ...incoming]);
        setTopics(
          Object.values(
            topicRows
              .map(normalizeTopicRow)
              .filter((topic) => topic.id)
              .reduce<Record<string, TopicOption>>((acc, topic) => {
                acc[`${topic.courseId}::${topic.id}`] = topic;
                return acc;
              }, {})
          )
        );

        setNodes(
          (graphData.nodes ?? []).map((n: any) => ({
            id: String(n.id),
            title: String(n.title ?? n.id),
            mastery: Number(n.mastery ?? 0),
            status: (n.status ?? 'not_started') as KGNode['status'],
            courseId: n.courseId ? String(n.courseId) : undefined,
            topicIds: Array.isArray((n as unknown as { topicIds?: unknown[] }).topicIds)
              ? ((n as unknown as { topicIds?: unknown[] }).topicIds || []).map((topicId) => String(topicId))
              : undefined,
            category: String(n.category ?? 'General'),
            decayTimestamp: n.decayTimestamp ?? null,
          }))
        );
        setLinks(
          (graphData.links ?? []).map((l: any) => ({
            source: String(l.source),
            target: String(l.target),
            type: l.type === 'prerequisite' ? 'prerequisite' : 'related',
          }))
        );
        setProgress(progressData);
      } catch {
        setLoadWarning(
          'Mentora could not reach the live learning services. The dashboard will stay available, but some personalized signals may be missing.'
        );
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [studentId, apiFetchWithAuth]);

  const visibleTopics = useMemo(
    () => (selectedCourse === 'all' ? topics : topics.filter((topic) => topic.courseId === selectedCourse)),
    [selectedCourse, topics]
  );
  const selectedCourseName = useMemo(
    () => courses.find((course) => course.id === selectedCourse)?.name ?? 'Course',
    [courses, selectedCourse]
  );

  useEffect(() => {
    if (selectedTopic === 'all') return;
    if (!visibleTopics.some((topic) => topic.id === selectedTopic)) {
      setSelectedTopic('all');
    }
  }, [selectedTopic, visibleTopics]);

  const filteredNodes = useMemo(() => {
    const normalize = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const selectedCourseMeta = courses.find((course) => course.id === selectedCourse);
    const courseNameNorm = normalize(selectedCourseMeta?.name ?? '').replace(/\b\d+\b/g, '').trim();
    const courseScopedNodes = nodes.filter((node) => {
      if (selectedCourse === 'all') return true;
      if (node.courseId) return node.courseId === selectedCourse;
      const categoryNorm = normalize(node.category ?? '');
      if (!categoryNorm || !courseNameNorm) return false;
      return (
        categoryNorm === courseNameNorm ||
        categoryNorm.includes(courseNameNorm) ||
        courseNameNorm.includes(categoryNorm)
      );
    });

    if (selectedTopic === 'all') {
      return courseScopedNodes;
    }

    const topicSet = new Set([selectedTopic]);
    return courseScopedNodes.filter((node) => {
      const nodeTopics = Array.isArray(node.topicIds) ? node.topicIds : [];
      if (nodeTopics.some((topicId) => topicSet.has(topicId))) return true;
      return topicSet.has(node.id);
    });
  }, [courses, nodes, selectedCourse, selectedTopic]);

  const filteredNodeIds = useMemo(() => new Set(filteredNodes.map(n => n.id)), [filteredNodes]);
  const linkNodeId = (end: string | { id?: string }) => typeof end === 'string' ? end : String(end?.id ?? '');
  const filteredLinks = useMemo(
    () => links.filter(l => filteredNodeIds.has(linkNodeId(l.source as any)) && filteredNodeIds.has(linkNodeId(l.target as any))),
    [links, filteredNodeIds]
  );

  const kgStats = progress?.kg_stats;
  const mastered = kgStats?.mastered ?? nodes.filter(n => n.status === 'mastered').length;
  const total = kgStats?.total_concepts ?? nodes.length;
  const masteryRate = total > 0 ? Math.round((mastered / total) * 100) : 0;
  const weakCount = kgStats?.weak ?? nodes.filter(n => n.status === 'weak').length;
  const learningCount = kgStats?.learning ?? nodes.filter(n => n.status === 'learning').length;

  const attentionConcepts = useMemo(
    () => nodes
      .filter(n => n.status === 'weak' || n.status === 'learning')
      .sort((a, b) => a.mastery - b.mastery),
    [nodes]
  );

  const attentionTotal = weakCount + learningCount;

  // Course-filtered attention for the Next Best Action panel
  const actionFilteredConcepts = useMemo(() => {
    if (actionCourse === 'all') return attentionConcepts;
    const selected = courses.find(c => c.id === actionCourse);
    if (!selected) return attentionConcepts;
    const normalize = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const courseNameNorm = normalize(selected.name).replace(/\b\d+\b/g, '').trim();
    return attentionConcepts.filter(n => {
      if (n.courseId) return n.courseId === actionCourse;
      const categoryNorm = normalize(n.category ?? '');
      if (!categoryNorm || !courseNameNorm) return false;
      return categoryNorm === courseNameNorm || categoryNorm.includes(courseNameNorm) || courseNameNorm.includes(categoryNorm);
    });
  }, [attentionConcepts, actionCourse, courses]);

  const actionWeakCount = actionFilteredConcepts.filter(n => n.status === 'weak').length;
  const actionLearningCount = actionFilteredConcepts.filter(n => n.status === 'learning').length;
  const actionAttentionTotal = actionWeakCount + actionLearningCount;
  const nextFocusConcept = actionFilteredConcepts[0];
  const actionFilteredIds = useMemo(
    () => new Set(actionFilteredConcepts.map((concept) => concept.id)),
    [actionFilteredConcepts]
  );
  const actionPrerequisiteCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const concept of actionFilteredConcepts) {
      counts.set(concept.id, 0);
    }
    for (const link of links) {
      if (link.type !== 'prerequisite') continue;
      if (!actionFilteredIds.has(link.source) || !actionFilteredIds.has(link.target)) continue;
      counts.set(link.target, (counts.get(link.target) ?? 0) + 1);
    }
    return counts;
  }, [actionFilteredConcepts, actionFilteredIds, links]);
  const actionUnlockCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const concept of actionFilteredConcepts) {
      counts.set(concept.id, 0);
    }
    for (const link of links) {
      if (link.type !== 'prerequisite') continue;
      if (!actionFilteredIds.has(link.source) || !actionFilteredIds.has(link.target)) continue;
      counts.set(link.source, (counts.get(link.source) ?? 0) + 1);
    }
    return counts;
  }, [actionFilteredConcepts, actionFilteredIds, links]);
  const recommendationReasons = useMemo(() => {
    if (!nextFocusConcept) return [];

    const reasons = [
      `Your current understanding is ${nextFocusConcept.mastery}%, so this topic still needs attention.`,
    ];
    const downstreamCount = actionUnlockCounts.get(nextFocusConcept.id) ?? 0;
    const prerequisiteCount = actionPrerequisiteCounts.get(nextFocusConcept.id) ?? 0;

    if (downstreamCount > 0) {
      reasons.push(
        `Reviewing this now can make ${downstreamCount} connected topic${downstreamCount === 1 ? '' : 's'} easier next.`
      );
    }

    if (prerequisiteCount > 0) {
      reasons.push(
        `It builds on ${prerequisiteCount} earlier topic${prerequisiteCount === 1 ? '' : 's'}, so strengthening it now can prevent confusion from stacking up.`
      );
    }

    if (nextFocusConcept.decayTimestamp) {
      reasons.push('This topic is due for review, so waiting longer increases the risk of forgetting it.');
    }

    return reasons;
  }, [actionPrerequisiteCounts, actionUnlockCounts, nextFocusConcept]);
  const recommendationCandidates = useMemo(
    () =>
      actionFilteredConcepts.slice(0, 8).map((concept, index) => ({
        concept_id: concept.id,
        title: concept.title,
        mastery: concept.mastery,
        status: concept.status,
        unlock_count: actionUnlockCounts.get(concept.id) ?? 0,
        prerequisite_count: actionPrerequisiteCounts.get(concept.id) ?? 0,
        has_decay: Boolean(concept.decayTimestamp),
        rank_hint: index + 1,
      })),
    [actionFilteredConcepts, actionPrerequisiteCounts, actionUnlockCounts]
  );
  const activeRecommendedConcept = useMemo(() => {
    if (!aiRecommendation?.concept_id) return nextFocusConcept;
    return actionFilteredConcepts.find((concept) => concept.id === aiRecommendation.concept_id) ?? nextFocusConcept;
  }, [actionFilteredConcepts, aiRecommendation?.concept_id, nextFocusConcept]);
  const activeRecommendationSummary = aiRecommendation?.summary
    ?? (activeRecommendedConcept
      ? `Review ${activeRecommendedConcept.title} first${actionAttentionTotal > 1 ? `, then clear ${actionAttentionTotal - 1} more` : ''}.`
      : '');
  const activeRecommendationDisclaimer = aiRecommendation?.disclaimer
    ?? 'This is guidance from your current learning signals, not an automatic grade or final judgment.';
  const activeRecommendationReasons = useMemo(() => {
    const sourceReasons = aiRecommendation?.reasons?.length
      ? aiRecommendation.reasons
      : recommendationReasons;

    const normalizedDisclaimer = activeRecommendationDisclaimer.trim().toLowerCase();
    const seen = new Set<string>();

    return sourceReasons.filter((reason) => {
      const normalizedReason = reason.trim().toLowerCase();
      if (!normalizedReason) return false;
      if (normalizedReason === normalizedDisclaimer) return false;
      if (seen.has(normalizedReason)) return false;
      seen.add(normalizedReason);
      return true;
    }).map(humanizeRecommendationReason);
  }, [activeRecommendationDisclaimer, aiRecommendation?.reasons, recommendationReasons]);
  const totalAttempts = progress?.total_attempts ?? 0;
  const accuracy = progress?.accuracy ?? 0;
  const accuracyPct = Math.round(accuracy * 100);
  const recentAttempts = progress?.recent_attempts ?? [];
  const courseProgress = useMemo(() => {
    const grouped: Record<string, KGNode[]> = {};
    nodes.forEach((n) => {
      const key = n.courseId || n.category || 'General';
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(n);
    });

    return Object.entries(grouped)
      .map(([key, courseNodes]) => {
        const course = courses.find(c => c.id === key);
        const masteredCount = courseNodes.filter(n => n.status === 'mastered').length;
        const weakCountForCourse = courseNodes.filter(n => n.status === 'weak').length;
        const totalMastery = courseNodes.reduce((sum, n) => sum + n.mastery, 0);
        const avgMastery = courseNodes.length > 0 ? Math.round(totalMastery / courseNodes.length) : 0;
        return {
          name: course?.name || key.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
          total: courseNodes.length,
          mastered: masteredCount,
          weak: weakCountForCourse,
          progress: avgMastery,
        };
      })
      .sort((a, b) => b.total - a.total);
  }, [nodes, courses]);

  const dashboardCourseOptions = useMemo(
    () => courses.filter((course) => course.id !== 'all'),
    [courses]
  );

  const courseTopicGroups = useMemo<CourseTopicGroup[]>(() => {
    const grouped = new Map<string, CourseTopicGroup>();

    for (const course of dashboardCourseOptions) {
      grouped.set(course.id, { id: course.id, name: course.name, topics: [] });
    }

    for (const topic of topics) {
      const existing = grouped.get(topic.courseId);
      if (existing) {
        existing.topics.push(topic);
      } else {
        grouped.set(topic.courseId, {
          id: topic.courseId,
          name: topic.courseName || topic.courseId,
          topics: [topic],
        });
      }
    }

    return Array.from(grouped.values())
      .map((group) => ({
        ...group,
        topics: [...group.topics].sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [dashboardCourseOptions, topics]);

  const topicRowKey = (topic: TopicOption) => topic.docId || `${topic.courseId}::${topic.id}`;

  const openCourseTopicManager = () => {
    setCourseTopicManagerError(null);
    setIsCourseTopicManagerOpen(true);
    setExpandedManagerCourses(new Set(courseTopicGroups.map((group) => group.id)));
  };

  const closeCourseTopicManager = () => {
    setIsCourseTopicManagerOpen(false);
    setCourseTopicManagerError(null);
    setRenamingCourseId(null);
    setRenamingCourseName('');
    setSavingCourseId(null);
    setRenamingTopicKey(null);
    setRenamingTopicName('');
    setSavingTopicKey(null);
    setAddingCourseInput('');
    setAddingTopicForCourseId(null);
    setAddingTopicInput('');
    setConfirmDelete(null);
  };

  const toggleManagerCourse = (courseId: string) => {
    setExpandedManagerCourses((prev) => {
      const next = new Set(prev);
      if (next.has(courseId)) next.delete(courseId);
      else next.add(courseId);
      return next;
    });
  };

  const startCourseRename = (courseId: string, courseName: string) => {
    setCourseTopicManagerError(null);
    setRenamingCourseId(courseId);
    setRenamingCourseName(courseName);
  };

  const cancelCourseRename = () => {
    setRenamingCourseId(null);
    setRenamingCourseName('');
    setSavingCourseId(null);
  };

  const saveCourseRename = async (courseId: string) => {
    const nextName = renamingCourseName.trim();
    if (!nextName) {
      setCourseTopicManagerError('Course name cannot be empty.');
      return;
    }

    setSavingCourseId(courseId);
    setCourseTopicManagerError(null);
    try {
      await apiFetchWithAuth<{ course: CourseOption }>(
        `/api/courses/${encodeURIComponent(courseId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ name: nextName }),
        }
      );

      setCourses((prev) =>
        prev.map((course) => (course.id === courseId ? { ...course, name: nextName } : course))
      );
      setTopics((prev) =>
        prev.map((topic) => (topic.courseId === courseId ? { ...topic, courseName: nextName } : topic))
      );
      cancelCourseRename();
    } catch (error) {
      setCourseTopicManagerError(error instanceof Error ? error.message : 'Failed to rename course.');
      setSavingCourseId(null);
    }
  };

  const startTopicRename = (topic: TopicOption) => {
    setCourseTopicManagerError(null);
    setRenamingTopicKey(topicRowKey(topic));
    setRenamingTopicName(topic.name);
  };

  const cancelTopicRename = () => {
    setRenamingTopicKey(null);
    setRenamingTopicName('');
    setSavingTopicKey(null);
  };

  const saveTopicRename = async (topic: TopicOption) => {
    const nextName = renamingTopicName.trim();
    if (!nextName) {
      setCourseTopicManagerError('Topic name cannot be empty.');
      return;
    }

    if (!topic.docId) {
      setCourseTopicManagerError('This topic cannot be renamed because its record id is missing.');
      return;
    }

    const key = topicRowKey(topic);
    setSavingTopicKey(key);
    setCourseTopicManagerError(null);
    try {
      await apiFetchWithAuth(
        `/api/user-topics/${encodeURIComponent(topic.docId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ topic_name: nextName }),
        }
      );

      setTopics((prev) =>
        prev.map((entry) => (topicRowKey(entry) === key ? { ...entry, name: nextName } : entry))
      );
      cancelTopicRename();
    } catch (error) {
      setCourseTopicManagerError(error instanceof Error ? error.message : 'Failed to rename topic.');
      setSavingTopicKey(null);
    }
  };

  const handleAddCourse = async () => {
    const name = addingCourseInput.trim();
    if (!name) {
      setCourseTopicManagerError('Course name cannot be empty.');
      return;
    }
    setSavingNewCourse(true);
    setCourseTopicManagerError(null);
    try {
      const created = await apiFetchWithAuth<{ course: CourseOption }>(
        '/api/courses',
        { method: 'POST', body: JSON.stringify({ name }) }
      );
      setCourses((prev) => [...prev, created.course]);
      setAddingCourseInput('');
    } catch (error) {
      setCourseTopicManagerError(error instanceof Error ? error.message : 'Failed to create course.');
    } finally {
      setSavingNewCourse(false);
    }
  };

  const handleDeleteCourse = async (courseId: string) => {
    setDeletingId(courseId);
    setCourseTopicManagerError(null);
    try {
      await apiFetchWithAuth(
        `/api/courses/${encodeURIComponent(courseId)}`,
        { method: 'DELETE' }
      );
      setCourses((prev) => prev.filter((c) => c.id !== courseId));
      setTopics((prev) => prev.filter((t) => t.courseId !== courseId));
      setConfirmDelete(null);
    } catch (error) {
      setCourseTopicManagerError(error instanceof Error ? error.message : 'Failed to delete course.');
      setConfirmDelete(null);
    } finally {
      setDeletingId(null);
    }
  };

  const handleAddTopic = async (courseId: string, courseName: string) => {
    const name = addingTopicInput.trim();
    if (!name) {
      setCourseTopicManagerError('Topic name cannot be empty.');
      return;
    }
    setSavingNewTopic(true);
    setCourseTopicManagerError(null);
    try {
      const created = await apiFetchWithAuth<{ topic: UserTopicApiRow }>(
        '/api/user-topics',
        { method: 'POST', body: JSON.stringify({ courseId, courseName, topicName: name }) }
      );
      setTopics((prev) => [...prev, normalizeTopicRow(created.topic)]);
      setAddingTopicForCourseId(null);
      setAddingTopicInput('');
    } catch (error) {
      setCourseTopicManagerError(error instanceof Error ? error.message : 'Failed to create topic.');
    } finally {
      setSavingNewTopic(false);
    }
  };

  const handleDeleteTopic = async (topic: TopicOption) => {
    if (!topic.docId) {
      setCourseTopicManagerError('This topic cannot be deleted because its record id is missing.');
      setConfirmDelete(null);
      return;
    }
    setDeletingId(topic.docId);
    setCourseTopicManagerError(null);
    try {
      await apiFetchWithAuth(
        `/api/user-topics/${encodeURIComponent(topic.docId)}`,
        { method: 'DELETE' }
      );
      setTopics((prev) => prev.filter((t) => t.docId !== topic.docId));
      setConfirmDelete(null);
    } catch (error) {
      setCourseTopicManagerError(error instanceof Error ? error.message : 'Failed to delete topic.');
      setConfirmDelete(null);
    } finally {
      setDeletingId(null);
    }
  };

  const faded = 'opacity-0 pointer-events-none';
  const visible = 'opacity-100';
  const BounceLoader = ({ size = 20 }: { size?: number }) => (
    <Image
      src="/logo-images/favicon.png"
      alt="Loading"
      width={size}
      height={size}
      className="animate-bounce"
      priority
    />
  );

  useEffect(() => {
    if (!isNeedsAttentionOpen && !isActivityOpen && !isCourseProgressOpen && !isCourseTopicManagerOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsNeedsAttentionOpen(false);
        setIsActivityOpen(false);
        setIsCourseProgressOpen(false);
        closeCourseTopicManager();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isNeedsAttentionOpen, isActivityOpen, isCourseProgressOpen, isCourseTopicManagerOpen]);

  useEffect(() => {
    if (loading || recommendationCandidates.length === 0) {
      setAiRecommendation(null);
      setRecommendationSource('heuristic');
      setRecommendationPending(false);
      return;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    const loadRecommendation = async () => {
      setRecommendationPending(true);
      try {
        const token = await getIdToken();
        const response = await fetch('/api/recommendation/next-action', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            course_name: courses.find((course) => course.id === actionCourse)?.name ?? 'All Courses',
            candidates: recommendationCandidates,
            attention_summary: {
              weak_count: actionWeakCount,
              learning_count: actionLearningCount,
            },
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Recommendation API failed with status ${response.status}`);
        }

        const data = await response.json() as AIRecommendation;
        setAiRecommendation(data);
        setRecommendationSource('backend-ai');
      } catch (error) {
        if (controller.signal.aborted) return;
        console.warn('Falling back to heuristic dashboard recommendation.', error);
        setAiRecommendation(null);
        setRecommendationSource('heuristic');
      } finally {
        clearTimeout(timeoutId);
        if (!controller.signal.aborted) {
          setRecommendationPending(false);
        }
      }
    };

    void loadRecommendation();

    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [
    actionAttentionTotal,
    actionCourse,
    actionLearningCount,
    actionWeakCount,
    courses,
    getIdToken,
    loading,
    recommendationCandidates,
  ]);

  return (
    <div
      className="min-h-full"
    >
      <div className="nav-safe-top p-6 max-w-7xl mx-auto overflow-x-hidden">
      <div className={`space-y-6 transition-opacity duration-300 ${isKGExpanded ? faded : visible}`}>
        <section>
          <h1 className="text-3xl font-bold text-black">Welcome back, {displayName}</h1>
          <p className="text-black mt-1">Here&apos;s your learning overview</p>
        </section>

        {loadWarning && (
          <Card className="rounded-2xl border-amber-300/50 bg-amber-500/10 p-4 text-slate-900 shadow-sm">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600" />
              <div>
                <p className="font-semibold text-amber-950">Partial live data issue</p>
                <p className="mt-1 text-sm text-amber-950/80">{loadWarning}</p>
              </div>
            </div>
          </Card>
        )}

        <Card className="glow-card relative overflow-hidden rounded-2xl border-white/15 bg-gradient-to-br from-slate-900/70 via-slate-800/60 to-slate-900/70 backdrop-blur-md shadow-xl text-white">
          <GlowingEffect spread={250} glow={true} disabled={false} proximity={80} borderWidth={2} variant="cyan" />
          <div className="p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#4cc9f0] flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5" /> Next Best Action
              </p>
              <select
                value={actionCourse}
                onChange={e => setActionCourse(e.target.value)}
                className="text-sm p-1.5 border border-white/20 rounded-lg bg-[#1a1a2e] text-white w-auto"
              >
                {courses.map(c => (
                  <option key={c.id} value={c.id} className="bg-[#1a1a2e] text-white">{c.name}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
              <div className="space-y-1">
                {loading ? (
                  <div className="flex items-center text-sm text-white/60">
                    <span className="mr-2 inline-flex"><BounceLoader size={16} /></span>
                    Preparing your focus queue...
                  </div>
                ) : actionAttentionTotal === 0 ? (
                  <p className="text-lg font-semibold">You&apos;re on track{actionCourse !== 'all' ? ` for ${courses.find(c => c.id === actionCourse)?.name}` : ''}. Keep momentum with a study mission.</p>
                ) : (
                  <>
                    <p className="text-lg font-semibold">
                      {activeRecommendationSummary.split(activeRecommendedConcept?.title ?? '').length > 1 && activeRecommendedConcept ? (
                        <>
                          {activeRecommendationSummary.split(activeRecommendedConcept.title)[0]}
                          <span className="text-[#4cc9f0]">{activeRecommendedConcept.title}</span>
                          {activeRecommendationSummary.slice(
                            activeRecommendationSummary.indexOf(activeRecommendedConcept.title) + activeRecommendedConcept.title.length
                          )}
                        </>
                      ) : (
                        activeRecommendationSummary
                      )}
                    </p>
                    <p className="text-sm text-white/60">
                      {activeRecommendedConcept && (
                        <span>
                          Current understanding: {activeRecommendedConcept.mastery}% ({formatLearningStatus(activeRecommendedConcept.status)}) &middot;{' '}
                        </span>
                      )}
                      {actionWeakCount} weak and {actionLearningCount} learning concepts need attention{actionCourse !== 'all' ? ` in ${courses.find(c => c.id === actionCourse)?.name}` : ''}.
                    </p>
                  </>
                )}
              </div>

              <div className="flex flex-wrap gap-2 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setIsNeedsAttentionOpen(true)}
                  className="px-4 py-2 text-sm rounded-full border border-white/30 bg-white/10 hover:bg-white/20 transition-colors text-white"
                >
                  View Attention List
                </button>
                <Link
                  href="/study-mission"
                  className="px-4 py-2 text-sm rounded-full bg-[#03b2e6] text-white hover:bg-[#029ad0] transition-colors inline-flex items-center gap-1.5"
                >
                  Start Study Mission
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>

            {!loading && activeRecommendedConcept && (
              <div className="rounded-2xl border border-cyan-300/20 bg-white/5 p-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-cyan-200">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Why Mentora Picked This
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-white/65">
                    {recommendationPending && <span>Refreshing...</span>}
                    <span className="rounded-full border border-white/15 bg-white/10 px-2.5 py-1">
                      {recommendationSource === 'backend-ai'
                        ? `AI via backend${aiRecommendation?.provider && aiRecommendation?.model
                          ? ` · ${aiRecommendation.provider}/${aiRecommendation.model}`
                          : aiRecommendation?.model
                            ? ` · ${aiRecommendation.model}`
                            : ''}`
                        : 'Local heuristic'}
                    </span>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-white/85">
                    Current understanding {activeRecommendedConcept.mastery}%
                  </span>
                  <span className="rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-white/85">
                    {formatLearningStatus(activeRecommendedConcept.status)}
                  </span>
                  {(actionUnlockCounts.get(activeRecommendedConcept.id) ?? 0) > 0 && (
                    <span className="rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-white/85">
                      Helps with {actionUnlockCounts.get(activeRecommendedConcept.id)} next topic{(actionUnlockCounts.get(activeRecommendedConcept.id) ?? 0) === 1 ? '' : 's'}
                    </span>
                  )}
                  {(actionPrerequisiteCounts.get(activeRecommendedConcept.id) ?? 0) > 0 && (
                    <span className="rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-white/85">
                      Builds on {actionPrerequisiteCounts.get(activeRecommendedConcept.id)} earlier topic{(actionPrerequisiteCounts.get(activeRecommendedConcept.id) ?? 0) === 1 ? '' : 's'}
                    </span>
                  )}
                  {activeRecommendedConcept.decayTimestamp && (
                    <span className="rounded-full border border-orange-300/25 bg-orange-400/10 px-2.5 py-1 text-orange-100">
                      Due for review
                    </span>
                  )}
                  {aiRecommendation?.confidence && (
                    <span className="rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-white/85">
                      {formatConfidenceLabel(aiRecommendation.confidence)}
                    </span>
                  )}
                </div>
                <div className="mt-3 space-y-1.5 text-sm text-white/75">
                  {activeRecommendationReasons.map((reason) => (
                    <p key={reason}>{reason}</p>
                  ))}
                </div>
                <div className="mt-4 rounded-xl border border-white/10 bg-black/15 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60">
                    How This Is Chosen
                  </p>
                  <p className="mt-1 text-sm text-white/70">
                    Mentora compares four signals: your current understanding, whether the topic is due for review,
                    how many later topics it can make easier, and whether it depends on earlier foundations first.
                  </p>
                </div>
                <p className="mt-3 text-xs text-white/55">
                  {activeRecommendationDisclaimer}
                </p>
              </div>
            )}
          </div>
        </Card>

        <section className="grid grid-cols-1 md:grid-cols-3 gap-5 items-stretch">
          <button
            type="button"
            onClick={() => setIsCourseProgressOpen(true)}
            className="w-full h-full text-left rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Open course mastery progress"
          >
            <Card className="glow-card p-5 h-full min-h-[140px] rounded-2xl bg-gradient-to-br from-slate-900/70 via-emerald-950/40 to-slate-900/70 backdrop-blur-md border-white/15 shadow-xl text-white relative overflow-hidden transition-all hover:shadow-emerald-500/10 hover:shadow-2xl">
              <GlowingEffect spread={200} glow={true} disabled={false} proximity={64} borderWidth={2} variant="cyan" />
              <div className="absolute top-0 left-0 w-1 h-full bg-emerald-400 rounded-l-xl" />
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-sm font-medium text-white/70">Mastery Progress</p>
                  {loading ? (
                    <div className="mt-3 text-white/60"><BounceLoader size={20} /></div>
                  ) : (
                    <>
                      <p className="text-3xl font-bold mt-2 text-emerald-400">{masteryRate}%</p>
                      <p className="text-sm text-white/60 mt-1">{mastered} of {total} concepts mastered</p>
                    </>
                  )}
                </div>
                <div className="p-2.5 rounded-xl bg-emerald-500/20">
                  <BookOpen className="h-5 w-5 text-emerald-400" />
                </div>
              </div>
            </Card>
          </button>

          <button
            type="button"
            onClick={() => setIsNeedsAttentionOpen(true)}
            className="w-full h-full text-left rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Open needs attention details"
          >
            <Card className="glow-card p-5 h-full min-h-[140px] rounded-2xl bg-gradient-to-br from-slate-900/70 via-amber-950/35 to-slate-900/70 backdrop-blur-md border-white/15 shadow-xl text-white relative overflow-hidden transition-all hover:shadow-amber-500/10 hover:shadow-2xl">
              <GlowingEffect spread={200} glow={true} disabled={false} proximity={64} borderWidth={2} variant="cyan" />
              <div className="absolute top-0 left-0 w-1 h-full bg-amber-400 rounded-l-xl" />
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-sm font-medium text-white/70">Needs Attention</p>
                  {loading ? (
                    <div className="mt-3 text-white/60"><BounceLoader size={20} /></div>
                  ) : (
                    <>
                      <p className="text-3xl font-bold mt-2 text-amber-400">{attentionTotal}</p>
                      <p className="text-sm text-white/60 mt-1">{weakCount} weak &middot; {learningCount} learning</p>
                    </>
                  )}
                </div>
                <div className="p-2.5 rounded-xl bg-amber-500/20">
                  <AlertTriangle className="h-5 w-5 text-amber-400" />
                </div>
              </div>
            </Card>
          </button>

          <button
            type="button"
            onClick={() => setIsActivityOpen(true)}
            className="w-full h-full text-left rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Open activity history"
          >
            <Card className="glow-card p-5 h-full min-h-[140px] rounded-2xl bg-gradient-to-br from-slate-900/70 via-sky-950/35 to-slate-900/70 backdrop-blur-md border-white/15 shadow-xl text-white relative overflow-hidden transition-all hover:shadow-sky-500/10 hover:shadow-2xl">
              <GlowingEffect spread={200} glow={true} disabled={false} proximity={64} borderWidth={2} variant="cyan" />
              <div className="absolute top-0 left-0 w-1 h-full bg-sky-400 rounded-l-xl" />
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-sm font-medium text-white/70">Activity</p>
                  {loading ? (
                    <div className="mt-3 text-white/60"><BounceLoader size={20} /></div>
                  ) : (
                    <>
                      <p className="text-3xl font-bold mt-2 text-sky-400">{totalAttempts}</p>
                      <p className="text-sm text-white/60 mt-1">{accuracyPct}% accuracy</p>
                    </>
                  )}
                </div>
                <div className="p-2.5 rounded-xl bg-sky-500/20">
                  <Target className="h-5 w-5 text-sky-400" />
                </div>
              </div>
            </Card>
          </button>
        </section>
      </div>

      <section className={`mt-8 space-y-6 transition-opacity duration-300 ${isKGExpanded ? faded : visible}`}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {progress && progress.self_awareness.total_attempts > 0 && (
            <Card className="glow-card rounded-2xl bg-gradient-to-br from-slate-900/70 via-indigo-950/30 to-slate-900/70 backdrop-blur-md border-white/15 shadow-xl text-white p-5">
              <h3 className="font-semibold mb-3">Self-Awareness Score</h3>
              <div className="flex items-center gap-6">
                <div>
                  <p className="text-3xl font-bold text-indigo-400">{Math.round(progress.self_awareness.score * 100)}%</p>
                  <p className="text-xs text-white/60">Confidence calibration</p>
                </div>
                <div className="flex-1">
                  <div className="w-full bg-white/10 rounded-full h-3">
                    <div className="bg-indigo-400 h-3 rounded-full" style={{ width: `${progress.self_awareness.score * 100}%` }} />
                  </div>
                  <div className="flex justify-between text-xs text-white/50 mt-1">
                    <span>Over-confident</span>
                    <span>Well-calibrated</span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium">{(progress.self_awareness.calibration_gap * 100).toFixed(0)}% gap</p>
                  <p className="text-xs text-white/60">{progress.self_awareness.total_attempts} rated</p>
                </div>
              </div>
            </Card>
          )}

          {progress && progress.total_attempts > 0 && (
            <Card className="glow-card rounded-2xl bg-gradient-to-br from-slate-900/70 via-rose-950/25 to-slate-900/70 backdrop-blur-md border-white/15 shadow-xl text-white p-5">
              <h3 className="font-semibold mb-3">Mistake Breakdown</h3>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-2xl font-bold text-emerald-400">{progress.correct_attempts}</p>
                  <p className="text-xs text-white/60">Correct</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-orange-400">{progress.careless_count}</p>
                  <p className="text-xs text-white/60">Careless</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-red-400">{progress.conceptual_count}</p>
                  <p className="text-xs text-white/60">Conceptual</p>
                </div>
              </div>
            </Card>
          )}
        </div>
      </section>

      <div className="mt-6 grid grid-cols-1 gap-6">
        <div className={`grid grid-cols-1 md:grid-cols-2 gap-6 transition-opacity duration-300 ${isKGExpanded ? faded : visible}`}>
          <Link href="/upload" className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Card className="glow-card p-5 rounded-2xl bg-gradient-to-br from-slate-900/70 via-fuchsia-950/25 to-slate-900/70 backdrop-blur-md border-white/15 shadow-xl text-white relative overflow-hidden transition-all hover:shadow-fuchsia-500/10 hover:shadow-2xl">
              <GlowingEffect spread={180} glow={true} disabled={false} proximity={64} borderWidth={2} variant="cyan" />
              <div className="absolute top-0 left-0 w-1 h-full bg-fuchsia-400 rounded-l-xl" />
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-white/75">Upload Materials</p>
                  <p className="text-lg font-semibold mt-1">Go To Upload Documents</p>
                  <p className="text-xs text-white/60 mt-1">Add new files to any course and topic.</p>
                </div>
                <div className="p-2.5 rounded-xl bg-fuchsia-500/20">
                  <Upload className="h-5 w-5 text-fuchsia-300" />
                </div>
              </div>
            </Card>
          </Link>

          <button
            type="button"
            onClick={openCourseTopicManager}
            className="w-full text-left rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Card className="glow-card p-5 rounded-2xl bg-gradient-to-br from-slate-900/70 via-cyan-950/25 to-slate-900/70 backdrop-blur-md border-white/15 shadow-xl text-white relative overflow-hidden transition-all hover:shadow-cyan-500/10 hover:shadow-2xl">
              <GlowingEffect spread={180} glow={true} disabled={false} proximity={64} borderWidth={2} variant="cyan" />
              <div className="absolute top-0 left-0 w-1 h-full bg-cyan-400 rounded-l-xl" />
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-white/75">Course Catalog</p>
                  <p className="text-lg font-semibold mt-1">Manage Courses And Topics</p>
                  <p className="text-xs text-white/60 mt-1">View all groups and rename course or topic labels.</p>
                </div>
                <div className="p-2.5 rounded-xl bg-cyan-500/20">
                  <Folder className="h-5 w-5 text-cyan-300" />
                </div>
              </div>
            </Card>
          </button>
        </div>

        <div
          className={`group transition-all duration-300 ${
            isKGExpanded ? 'fixed inset-8 z-40' : ''
          }`}
        >
          <Card className="glow-card overflow-hidden h-full flex flex-col rounded-2xl bg-gradient-to-br from-slate-900/70 via-slate-800/60 to-slate-900/70 backdrop-blur-md border-white/15 shadow-xl text-white">
            <div className="p-4 border-b flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h3 className="font-semibold">Knowledge Map</h3>
                <p className="text-xs text-white/60 mt-1">Use labels toggle for a cleaner map when many topics are present.</p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <select
                  value={selectedCourse}
                  onChange={(event) => setSelectedCourse(event.target.value)}
                  className="text-sm p-1.5 border border-white/20 rounded-lg bg-[#1a1a2e] text-white"
                >
                  {courses.map((course) => (
                    <option key={course.id} value={course.id} className="bg-[#1a1a2e] text-white">{course.name}</option>
                  ))}
                </select>
                <select
                  value={selectedTopic}
                  onChange={(event) => setSelectedTopic(event.target.value)}
                  className="text-sm p-1.5 border border-white/20 rounded-lg bg-[#1a1a2e] text-white min-w-[180px]"
                  title="Filter by topic"
                >
                  <option value="all" className="bg-[#1a1a2e] text-white">
                    {selectedCourse === 'all' ? 'All Topics' : `All Topics in ${selectedCourseName}`}
                  </option>
                  {visibleTopics.map((topic) => (
                    <option key={`${topic.courseId}-${topic.id}`} value={topic.id} className="bg-[#1a1a2e] text-white">
                      {topic.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setShowMapLabels(prev => !prev)}
                  className="text-xs px-2.5 py-1.5 rounded-lg border border-white/20 hover:bg-white/10 transition-colors text-white/80"
                >
                  {showMapLabels ? 'Hide Labels' : 'Show Labels'}
                </button>
                <button
                  onClick={toggleKG}
                  className="p-1 rounded hover:bg-white/10 text-white/60"
                  title={isKGExpanded ? 'Collapse' : 'Expand'}
                  aria-label={isKGExpanded ? 'Collapse knowledge map' : 'Expand knowledge map'}
                >
                  {isKGExpanded
                    ? <Minimize2 className="w-4 h-4" />
                    : <Maximize2 className="w-4 h-4" />
                  }
                </button>
              </div>
            </div>
            <div className={`${isKGExpanded ? 'flex-1 min-h-0' : 'h-[544px]'}`}>
              {loading ? (
                <div className="h-full flex items-center justify-center text-sm text-white/60">
                  <span className="mr-2 inline-flex"><BounceLoader size={20} /></span> Loading knowledge graph...
                </div>
              ) : (
                <KnowledgeGraph
                  nodes={filteredNodes.map(n => ({
                    id: n.id,
                    title: n.title,
                    mastery: n.mastery,
                    status: n.status,
                    lastReviewed: '',
                    decayRate: 0,
                    category: n.category ?? 'General',
                  }))}
                  links={filteredLinks}
                  showLabels={showMapLabels}
                />
              )}
            </div>
          </Card>
        </div>
      </div>

      {isCourseTopicManagerOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4"
          onClick={closeCourseTopicManager}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Manage courses and topics"
            className="w-full max-w-3xl max-h-[82vh] rounded-2xl border border-white/20 bg-slate-900/90 backdrop-blur-md shadow-2xl text-slate-100 overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="p-4 border-b border-white/15 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-white">Manage Courses & Topics</h3>
                <p className="text-xs text-white/65 mt-1">
                  Add, rename, or delete courses and topics used across the dashboard.
                </p>
              </div>
              <button
                type="button"
                onClick={closeCourseTopicManager}
                className="p-1 rounded hover:bg-white/10 text-white/70"
                aria-label="Close manager"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto max-h-[calc(82vh-78px)]">
              {courseTopicManagerError && (
                <div className="mb-3 rounded-lg border border-red-300/30 bg-red-500/15 px-3 py-2 text-sm text-red-100">
                  {courseTopicManagerError}
                </div>
              )}

              {courseTopicGroups.length === 0 ? (
                <div className="text-center py-10 text-sm text-slate-300">
                  No courses yet. Add your first course below.
                </div>
              ) : (
                <div className="space-y-3">
                  {courseTopicGroups.map((group) => (
                    <div key={group.id}>
                      {renamingCourseId === group.id ? (
                        <div className="flex items-center w-full p-2 rounded border border-white/25 bg-slate-800/55 gap-2">
                          {expandedManagerCourses.has(group.id) ? (
                            <ChevronDown className="w-4 h-4 flex-shrink-0" />
                          ) : (
                            <ChevronRight className="w-4 h-4 flex-shrink-0" />
                          )}
                          <Folder className="w-5 h-5 text-blue-500 flex-shrink-0" />
                          <input
                            autoFocus
                            value={renamingCourseName}
                            onChange={(event) => setRenamingCourseName(event.target.value)}
                            className="flex-1 min-w-0 rounded border border-cyan-200/40 bg-slate-900/80 px-2 py-1 text-sm text-white outline-none focus:border-cyan-300"
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                void saveCourseRename(group.id);
                              } else if (event.key === 'Escape') {
                                event.preventDefault();
                                cancelCourseRename();
                              }
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => void saveCourseRename(group.id)}
                            disabled={savingCourseId === group.id}
                            className="px-2 py-1 rounded border border-cyan-200/40 text-cyan-100 hover:bg-cyan-500/20 disabled:opacity-60 text-xs"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={cancelCourseRename}
                            disabled={savingCourseId === group.id}
                            className="px-2 py-1 rounded border border-white/30 text-white/85 hover:bg-white/10 disabled:opacity-60 text-xs"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="group flex items-center w-full p-2 rounded border border-white/25 bg-slate-800/55 hover:bg-slate-700/65 transition-colors shadow-sm">
                          <button
                            type="button"
                            className="flex items-center flex-1 min-w-0"
                            onClick={() => toggleManagerCourse(group.id)}
                            title={group.name}
                          >
                            {expandedManagerCourses.has(group.id) ? (
                              <ChevronDown className="w-4 h-4 mr-2 flex-shrink-0" />
                            ) : (
                              <ChevronRight className="w-4 h-4 mr-2 flex-shrink-0" />
                            )}
                            <Folder className="w-5 h-5 mr-2 text-blue-500 flex-shrink-0" />
                            <span className="font-semibold truncate text-white">{group.name}</span>
                            <span className="ml-2 text-xs text-white/55">{group.topics.length} topic{group.topics.length === 1 ? '' : 's'}</span>
                          </button>
                          <button
                            type="button"
                            className="opacity-0 group-hover:opacity-100 p-1 text-slate-200 hover:text-cyan-200 transition-opacity flex-shrink-0 rounded hover:bg-white/10"
                            title="Rename course"
                            onClick={(event) => {
                              event.stopPropagation();
                              startCourseRename(group.id, group.name);
                            }}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            className="opacity-0 group-hover:opacity-100 p-1 text-slate-200 hover:text-red-400 transition-opacity flex-shrink-0 rounded hover:bg-white/10"
                            title="Delete course"
                            onClick={(event) => {
                              event.stopPropagation();
                              setConfirmDelete({ type: 'course', courseId: group.id, courseName: group.name });
                            }}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}

                      {expandedManagerCourses.has(group.id) && (
                        <div className="ml-6 space-y-1 mt-1">
                          {group.topics.length === 0 ? (
                            <div className="rounded-md border border-white/20 bg-slate-900/45 px-3 py-2 text-xs text-white/60">
                              No topics in this course yet.
                            </div>
                          ) : (
                            group.topics.map((topic) => {
                              const key = topicRowKey(topic);
                              const isRenaming = renamingTopicKey === key;
                              return (
                                <div
                                  key={key}
                                  className="group flex items-center rounded-md border border-white/20 bg-slate-900/45"
                                >
                                  {isRenaming ? (
                                    <div className="flex items-center flex-1 min-w-0 p-2 gap-2">
                                      <FileText className="w-4 h-4 text-white/90 flex-shrink-0" />
                                      <input
                                        autoFocus
                                        value={renamingTopicName}
                                        onChange={(event) => setRenamingTopicName(event.target.value)}
                                        className="flex-1 min-w-0 rounded border border-cyan-200/40 bg-slate-900/80 px-2 py-1 text-sm text-white outline-none focus:border-cyan-300"
                                        onKeyDown={(event) => {
                                          if (event.key === 'Enter') {
                                            event.preventDefault();
                                            void saveTopicRename(topic);
                                          } else if (event.key === 'Escape') {
                                            event.preventDefault();
                                            cancelTopicRename();
                                          }
                                        }}
                                      />
                                      <button
                                        type="button"
                                        onClick={() => void saveTopicRename(topic)}
                                        disabled={savingTopicKey === key}
                                        className="px-2 py-1 rounded border border-cyan-200/40 text-cyan-100 hover:bg-cyan-500/20 disabled:opacity-60 text-xs"
                                      >
                                        Save
                                      </button>
                                      <button
                                        type="button"
                                        onClick={cancelTopicRename}
                                        disabled={savingTopicKey === key}
                                        className="px-2 py-1 rounded border border-white/30 text-white/85 hover:bg-white/10 disabled:opacity-60 text-xs"
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  ) : (
                                    <>
                                      <div className="flex items-center flex-1 min-w-0 p-2 text-sm text-white">
                                        <FileText className="w-4 h-4 mr-2 flex-shrink-0 text-white/90" />
                                        <span className="truncate font-medium">{topic.name}</span>
                                      </div>
                                      <button
                                        type="button"
                                        className="opacity-0 group-hover:opacity-100 p-1 text-slate-200 hover:text-cyan-200 transition-opacity flex-shrink-0 rounded hover:bg-white/10"
                                        title="Rename topic"
                                        onClick={() => startTopicRename(topic)}
                                      >
                                        <Pencil className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        className="opacity-0 group-hover:opacity-100 p-1 text-slate-200 hover:text-red-400 transition-opacity flex-shrink-0 rounded hover:bg-white/10 mr-1"
                                        title="Delete topic"
                                        onClick={() => setConfirmDelete({ type: 'topic', topic })}
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </>
                                  )}
                                </div>
                              );
                            })
                          )}

                          {/* Add topic form */}
                          {addingTopicForCourseId === group.id ? (
                            <div className="flex items-center gap-2 rounded-md border border-cyan-200/30 bg-slate-800/60 px-2 py-1.5 mt-1">
                              <FileText className="w-4 h-4 text-white/50 flex-shrink-0" />
                              <input
                                autoFocus
                                value={addingTopicInput}
                                onChange={(e) => setAddingTopicInput(e.target.value)}
                                placeholder="New topic name…"
                                className="flex-1 min-w-0 rounded border border-cyan-200/40 bg-slate-900/80 px-2 py-1 text-sm text-white outline-none focus:border-cyan-300"
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') { e.preventDefault(); void handleAddTopic(group.id, group.name); }
                                  else if (e.key === 'Escape') { e.preventDefault(); setAddingTopicForCourseId(null); setAddingTopicInput(''); }
                                }}
                              />
                              <button
                                type="button"
                                onClick={() => void handleAddTopic(group.id, group.name)}
                                disabled={savingNewTopic}
                                className="px-2 py-1 rounded border border-cyan-200/40 text-cyan-100 hover:bg-cyan-500/20 disabled:opacity-60 text-xs"
                              >
                                {savingNewTopic ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Add'}
                              </button>
                              <button
                                type="button"
                                onClick={() => { setAddingTopicForCourseId(null); setAddingTopicInput(''); }}
                                disabled={savingNewTopic}
                                className="px-2 py-1 rounded border border-white/30 text-white/85 hover:bg-white/10 disabled:opacity-60 text-xs"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => { setCourseTopicManagerError(null); setAddingTopicForCourseId(group.id); setAddingTopicInput(''); }}
                              className="flex items-center gap-1.5 mt-1 px-2 py-1 rounded text-xs text-white/50 hover:text-cyan-300 hover:bg-white/5 transition-colors"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              Add topic
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Add new course */}
              <div className="mt-4 pt-4 border-t border-white/10">
                <div className="flex items-center gap-2">
                  <input
                    value={addingCourseInput}
                    onChange={(e) => setAddingCourseInput(e.target.value)}
                    placeholder="New course name…"
                    className="flex-1 min-w-0 rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/35 outline-none focus:border-cyan-300"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); void handleAddCourse(); }
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => void handleAddCourse()}
                    disabled={savingNewCourse || !addingCourseInput.trim()}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#03b2e6] text-white text-sm font-medium hover:bg-[#029ad0] disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                  >
                    {savingNewCourse ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    Add Course
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4"
          onClick={() => setConfirmDelete(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-sm rounded-2xl border border-white/20 bg-slate-900/95 backdrop-blur-md shadow-2xl text-slate-100 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="p-2 rounded-full bg-red-500/15 flex-shrink-0">
                <Trash2 className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h4 className="font-semibold text-white">
                  Delete {confirmDelete.type === 'course' ? 'Course' : 'Topic'}?
                </h4>
                <p className="text-sm text-white/65 mt-1">
                  {confirmDelete.type === 'course'
                    ? <>Are you sure you want to delete <span className="text-white font-medium">{confirmDelete.courseName}</span>? All topics under this course will also be removed.</>
                    : <>Are you sure you want to delete <span className="text-white font-medium">{confirmDelete.topic.name}</span>? This cannot be undone.</>
                  }
                </p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                disabled={deletingId !== null}
                className="px-4 py-2 rounded-lg border border-white/20 text-sm text-white/85 hover:bg-white/10 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deletingId !== null}
                onClick={() => {
                  if (confirmDelete.type === 'course') void handleDeleteCourse(confirmDelete.courseId);
                  else void handleDeleteTopic(confirmDelete.topic);
                }}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-600 text-sm text-white font-medium hover:bg-red-500 disabled:opacity-60"
              >
                {deletingId !== null ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {isNeedsAttentionOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setIsNeedsAttentionOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Needs attention details"
            className="w-full max-w-2xl max-h-[80vh] bg-card rounded-xl shadow-xl border overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="p-4 border-b flex items-center justify-between">
              <div>
                <h3 className="font-semibold">Needs Attention</h3>
                <p className="text-sm text-muted-foreground">Concepts that are weak or still learning</p>
              </div>
              <button
                type="button"
                onClick={() => setIsNeedsAttentionOpen(false)}
                className="p-1 rounded hover:bg-accent text-muted-foreground"
                aria-label="Close needs attention details"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto max-h-[calc(80vh-72px)]">
              {loading ? (
                <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                  <span className="mr-2 inline-flex"><BounceLoader size={20} /></span>
                  Loading concepts...
                </div>
              ) : attentionConcepts.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No concepts currently need attention.</p>
              ) : (
                <div className="space-y-3">
                  {attentionConcepts.map((concept) => (
                    <div key={concept.id} className="border rounded-lg p-3">
                      <div className="flex items-start justify-between gap-3">
                        <p className="font-medium">{concept.title}</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          concept.status === 'weak' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                        }`}>
                          {concept.status === 'weak' ? 'Weak' : 'Learning'}
                        </span>
                      </div>
                      <div className="mt-2">
                        <div className="w-full bg-muted rounded-full h-1.5">
                          <div
                            className={`h-1.5 rounded-full ${
                              concept.mastery >= 70 ? 'bg-green-500' : concept.mastery >= 40 ? 'bg-yellow-500' : 'bg-red-500'
                            }`}
                            style={{ width: `${concept.mastery}%` }}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">Mastery: {concept.mastery}%</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {isActivityOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setIsActivityOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Recent activity history"
            className="w-full max-w-2xl max-h-[80vh] bg-card rounded-xl shadow-xl border overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="p-4 border-b flex items-center justify-between">
              <div>
                <h3 className="font-semibold">Recent Activity</h3>
                <p className="text-sm text-muted-foreground">Your latest assessment outcomes</p>
              </div>
              <button
                type="button"
                onClick={() => setIsActivityOpen(false)}
                className="p-1 rounded hover:bg-accent text-muted-foreground"
                aria-label="Close activity history"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto max-h-[calc(80vh-72px)]">
              {loading ? (
                <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                  <span className="mr-2 inline-flex"><BounceLoader size={20} /></span>
                  Loading activity...
                </div>
              ) : recentAttempts.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No activity yet. Take an assessment to generate history.</p>
              ) : (
                <div className="space-y-2">
                  {recentAttempts.slice(-12).reverse().map((attempt, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm border rounded-lg p-3">
                      <span className={`w-2 h-2 rounded-full ${attempt.is_correct ? 'bg-green-500' : 'bg-red-500'}`} />
                      <span className="flex-1 truncate">{attempt.concept || 'Assessment'}</span>
                      {attempt.mistake_type && attempt.mistake_type !== 'normal' && (
                        <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                          attempt.mistake_type === 'careless' ? 'bg-orange-100 text-orange-700' : 'bg-red-100 text-red-700'
                        }`}>
                          {attempt.mistake_type}
                        </span>
                      )}
                      <span className={`text-xs ${attempt.is_correct ? 'text-green-600' : 'text-red-600'}`}>
                        {attempt.is_correct ? 'Correct' : 'Incorrect'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {isCourseProgressOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setIsCourseProgressOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Knowledge graph progress by course"
            className="w-full max-w-2xl max-h-[80vh] bg-card rounded-xl shadow-xl border overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="p-4 border-b flex items-center justify-between">
              <div>
                <h3 className="font-semibold">Knowledge Graph Progress By Course</h3>
                <p className="text-sm text-muted-foreground">Course-level mastery breakdown</p>
              </div>
              <button
                type="button"
                onClick={() => setIsCourseProgressOpen(false)}
                className="p-1 rounded hover:bg-accent text-muted-foreground"
                aria-label="Close course progress"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto max-h-[calc(80vh-72px)]">
              {loading ? (
                <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                  <span className="mr-2 inline-flex"><BounceLoader size={18} /></span>
                  Loading course progress...
                </div>
              ) : courseProgress.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No course data yet. Upload materials to get started.</p>
              ) : (
                <div className="space-y-3">
                  {courseProgress.map((course, index) => (
                    <div key={index} className="rounded-xl border p-4">
                      <div className="flex justify-between items-center mb-3">
                        <div>
                          <h4 className="font-medium">{course.name}</h4>
                          <p className="text-xs text-muted-foreground">{course.total} concepts</p>
                        </div>
                        <p className="font-semibold">{course.progress}%</p>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2 mb-2">
                        <div className="bg-[#03b2e6] h-2 rounded-full" style={{ width: `${course.progress}%` }} />
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-green-600">{course.mastered} mastered</span>
                        <span className="text-red-600">{course.weak} weak</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
