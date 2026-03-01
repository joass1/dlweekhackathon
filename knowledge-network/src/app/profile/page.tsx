// src/app/profile/page.tsx
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Brain, Book, Clock, Trophy } from 'lucide-react';

export default function ProfilePage() {
  const courseProgress = [
    {
      course: 'Data Structures',
      progress: 75,
      grade: 'A',
      conceptsMastered: 12,
      conceptsNeedWork: 3
    },
    {
      course: 'Physics 101',
      progress: 82,
      grade: 'A-',
      conceptsMastered: 15,
      conceptsNeedWork: 2
    },
    {
      course: 'Biology',
      progress: 68,
      grade: 'B+',
      conceptsMastered: 10,
      conceptsNeedWork: 5
    }
  ];

  return (
    <div className="p-6">
      <div className="flex items-center gap-6 mb-8">
        <div className="w-24 h-24 bg-purple-600 rounded-full flex items-center justify-center text-white text-3xl">
          JS
        </div>
        <div>
          <h1 className="text-2xl font-bold">John Smith</h1>
          <p className="text-gray-600">Computer Science Major</p>
          <p className="text-gray-600">Year 2 • GPA: 3.8</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { title: 'Concepts Mastered', value: '37', icon: Brain },
          { title: 'Courses Enrolled', value: '4', icon: Book },
          { title: 'Peer sessions completed', value: '7', icon: Clock },
          { title: 'Achievements', value: '15', icon: Trophy }
        ].map((stat, index) => {
          const Icon = stat.icon;
          return (
            <Card key={index}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  {stat.title}
                </CardTitle>
                <Icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stat.value}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <h2 className="text-xl font-semibold mb-4">Course Progress</h2>
      <div className="space-y-4">
        {courseProgress.map((course, index) => (
          <Card key={index}>
            <CardContent className="pt-6">
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h3 className="font-semibold">{course.course}</h3>
                  <p className="text-sm text-gray-500">Grade: {course.grade}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold">{course.progress}%</p>
                  <p className="text-sm text-gray-500">Overall Progress</p>
                </div>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2 mb-4">
                <div
                  className="bg-purple-600 h-2 rounded-full"
                  style={{ width: `${course.progress}%` }}
                />
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-green-600">{course.conceptsMastered} concepts mastered</span>
                <span className="text-red-600">{course.conceptsNeedWork} needs work</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}