import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Brain, Users, BookOpen, Clock } from 'lucide-react';

export const DashboardStats = () => {
  const stats = [
    {
      title: "Weekly Assessments",
      value: "4/4",
      description: "Completed this week",
      icon: Brain
    },
    {
      title: "Study Sessions",
      value: "12",
      description: "Scheduled this week",
      icon: Users
    },
    {
      title: "Concepts Mastered",
      value: "85%",
      description: "Average confidence",
      icon: BookOpen
    },
    {
      title: "Study Time",
      value: "24h",
      description: "This week",
      icon: Clock
    }
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((stat, index) => {
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
              <p className="text-xs text-muted-foreground">
                {stat.description}
              </p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
};