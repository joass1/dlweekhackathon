export interface CourseOption {
  id: string;
  name: string;
}

export const DEFAULT_COURSES: CourseOption[] = [
  { id: "physics-101", name: "Physics 101" },
  { id: "data-structures", name: "Data Structures" },
  { id: "biology-intro", name: "Introduction to Biology" },
];

const STORAGE_KEY = "learngraph:courses";

const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const loadCourses = (): CourseOption[] => {
  if (typeof window === "undefined") return DEFAULT_COURSES;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_COURSES;
    const parsed = JSON.parse(raw) as CourseOption[];
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_COURSES;
    return parsed.filter((c) => c?.id && c?.name);
  } catch {
    return DEFAULT_COURSES;
  }
};

export const saveCourses = (courses: CourseOption[]) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(courses));
};

export const addCourse = (courses: CourseOption[], name: string): CourseOption[] => {
  const trimmed = name.trim();
  if (!trimmed) return courses;

  const exists = courses.some((c) => c.name.toLowerCase() === trimmed.toLowerCase());
  if (exists) return courses;

  const baseId = slugify(trimmed) || "course";
  let id = baseId;
  let i = 2;
  while (courses.some((c) => c.id === id)) {
    id = `${baseId}-${i}`;
    i += 1;
  }

  const next = [...courses, { id, name: trimmed }];
  saveCourses(next);
  return next;
};
