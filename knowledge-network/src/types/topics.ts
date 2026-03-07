export interface TopicOption {
  id: string;
  name: string;
  courseId: string;
  courseName: string;
  docId?: string;
}

export interface UserTopicApiRow {
  id: string;
  courseId: string;
  courseName: string;
  topicId?: string;
  topicName?: string;
  conceptId?: string;
  title?: string;
  chunkCount?: number;
}

export const normalizeTopicRow = (row: UserTopicApiRow): TopicOption => {
  const id = (row.topicId || row.conceptId || "").trim();
  const name = (row.topicName || row.title || id || "Topic").trim();
  return {
    id,
    name,
    courseId: (row.courseId || "uncategorized").trim() || "uncategorized",
    courseName: (row.courseName || "Uncategorized").trim() || "Uncategorized",
    docId: (row.id || "").trim() || undefined,
  };
};

