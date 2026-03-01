'use client';

import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { Card } from '@/components/ui/card';

interface Node {
  id: string;
  title: string;
  stage: number;
  type: 'idea' | 'refinement' | 'discussion';
  engagement: number;
}

interface Link {
  source: string;
  target: string;
  strength: number;
}

const KnowledgeGraph = () => {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current) return;

    // Mock data - replace with real data
    const nodes: Node[] = [
      { id: '1', title: 'AI in Disaster Relief', stage: 4, type: 'idea', engagement: 85 },
      { id: '2', title: 'Drone Mapping Systems', stage: 3, type: 'refinement', engagement: 72 },
      { id: '3', title: 'Real-time Data Processing', stage: 2, type: 'discussion', engagement: 65 }
    ];

    const links: Link[] = [
      { source: '1', target: '2', strength: 0.7 },
      { source: '2', target: '3', strength: 0.5 }
    ];

    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    // Create force simulation
    const simulation = d3.forceSimulation<Node>(nodes)
      .force('link', d3.forceLink<Node, Link>(links).id(d => d.id))
      .force('charge', d3.forceManyBody().strength(-200))
      .force('center', d3.forceCenter(width / 2, height / 2));

    // Add links
    const link = svg.append('g')
      .selectAll('line')
      .data(links)
      .join('line')
      .style('stroke', '#ddd')
      .style('stroke-width', d => Math.sqrt(d.strength) * 2);

    // Add nodes
    const node = svg.append('g')
      .selectAll('circle')
      .data(nodes)
      .join('circle')
      .attr('r', d => Math.sqrt(d.engagement) * 2)
      .style('fill', d => {
        switch (d.stage) {
          case 4: return '#4ade80'; // Green for well-refined
          case 3: return '#fbbf24'; // Yellow for needs validation
          default: return '#f87171'; // Red for controversial
        }
      });

    // Add labels
    const label = svg.append('g')
      .selectAll('text')
      .data(nodes)
      .join('text')
      .text(d => d.title)
      .attr('font-size', '12px')
      .attr('dx', 15)
      .attr('dy', 4);

    // Update positions
    simulation.on('tick', () => {
      link
        .attr('x1', d => (d.source as Node).x ?? 0)
        .attr('y1', d => (d.source as Node).y ?? 0)
        .attr('x2', d => (d.target as Node).x ?? 0)
        .attr('y2', d => (d.target as Node).y ?? 0);

      node
        .attr('cx', d => d.x ?? 0)
        .attr('cy', d => d.y ?? 0);

      label
        .attr('x', d => d.x ?? 0)
        .attr('y', d => d.y ?? 0);
    });

    // Add interactivity
    node.on('mouseover', function(event, d) {
      d3.select(this)
        .transition()
        .duration(200)
        .attr('r', d => Math.sqrt(d.engagement) * 2.5);
    }).on('mouseout', function(event, d) {
      d3.select(this)
        .transition()
        .duration(200)
        .attr('r', d => Math.sqrt(d.engagement) * 2);
    });

  }, []);

  return (
    <div className="w-full h-full">
      <svg ref={svgRef} className="w-full h-full" />
    </div>
  );
};

export default KnowledgeGraph; 