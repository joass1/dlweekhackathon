'use client';

import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';

interface Node extends d3.SimulationNodeDatum {
  id: string;
  title: string;
  mastery: number;
  status: 'mastered' | 'learning' | 'weak' | 'not_started';
  lastReviewed: string;
  decayRate: number;
  category: string;
}

interface Link extends d3.SimulationLinkDatum<Node> {
  source: string;
  target: string;
  type: 'prerequisite' | 'related';
}

const KnowledgeGraph = () => {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current) return;

    const nodes: Node[] = [
      { id: '1', title: "Newton's 1st Law", mastery: 92, status: 'mastered', lastReviewed: '2026-02-28', decayRate: 14, category: 'Physics' },
      { id: '2', title: "Newton's 2nd Law", mastery: 78, status: 'learning', lastReviewed: '2026-02-25', decayRate: 7, category: 'Physics' },
      { id: '3', title: "Newton's 3rd Law", mastery: 45, status: 'weak', lastReviewed: '2026-02-20', decayRate: 3, category: 'Physics' },
      { id: '4', title: 'Free Body Diagrams', mastery: 85, status: 'mastered', lastReviewed: '2026-02-27', decayRate: 10, category: 'Physics' },
      { id: '5', title: 'Friction', mastery: 60, status: 'learning', lastReviewed: '2026-02-22', decayRate: 5, category: 'Physics' },
      { id: '6', title: 'Momentum', mastery: 30, status: 'weak', lastReviewed: '2026-02-15', decayRate: 2, category: 'Physics' },
      { id: '7', title: 'Conservation of Energy', mastery: 0, status: 'not_started', lastReviewed: '', decayRate: 0, category: 'Physics' },
      { id: '8', title: 'Work-Energy Theorem', mastery: 55, status: 'learning', lastReviewed: '2026-02-23', decayRate: 4, category: 'Physics' },
      { id: '9', title: 'Kinetic Energy', mastery: 70, status: 'learning', lastReviewed: '2026-02-26', decayRate: 6, category: 'Physics' },
      { id: '10', title: 'Potential Energy', mastery: 40, status: 'weak', lastReviewed: '2026-02-18', decayRate: 3, category: 'Physics' },
      { id: '11', title: 'Arrays', mastery: 95, status: 'mastered', lastReviewed: '2026-02-28', decayRate: 21, category: 'Data Structures' },
      { id: '12', title: 'Linked Lists', mastery: 88, status: 'mastered', lastReviewed: '2026-02-27', decayRate: 14, category: 'Data Structures' },
      { id: '13', title: 'Binary Trees', mastery: 65, status: 'learning', lastReviewed: '2026-02-24', decayRate: 5, category: 'Data Structures' },
      { id: '14', title: 'Graph Algorithms', mastery: 20, status: 'weak', lastReviewed: '2026-02-10', decayRate: 2, category: 'Data Structures' },
    ];

    const links: Link[] = [
      { source: '1', target: '2', type: 'prerequisite' },
      { source: '2', target: '3', type: 'prerequisite' },
      { source: '1', target: '4', type: 'prerequisite' },
      { source: '4', target: '5', type: 'related' },
      { source: '3', target: '6', type: 'prerequisite' },
      { source: '9', target: '8', type: 'prerequisite' },
      { source: '10', target: '7', type: 'prerequisite' },
      { source: '8', target: '7', type: 'prerequisite' },
      { source: '11', target: '12', type: 'prerequisite' },
      { source: '12', target: '13', type: 'prerequisite' },
      { source: '13', target: '14', type: 'prerequisite' },
    ];

    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    // Arrowhead marker for prerequisite edges
    svg.append('defs').append('marker')
      .attr('id', 'arrowhead')
      .attr('viewBox', '-0 -5 10 10')
      .attr('refX', 25)
      .attr('refY', 0)
      .attr('orient', 'auto')
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .append('path')
      .attr('d', 'M 0,-5 L 10,0 L 0,5')
      .attr('fill', '#94a3b8');

    const simulation = d3.forceSimulation<Node>(nodes)
      .force('link', d3.forceLink<Node, Link>(links).id(d => d.id).distance(100))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(35));

    // Links
    const link = svg.append('g')
      .selectAll('line')
      .data(links)
      .join('line')
      .style('stroke', d => d.type === 'prerequisite' ? '#94a3b8' : '#e2e8f0')
      .style('stroke-width', d => d.type === 'prerequisite' ? 2 : 1)
      .style('stroke-dasharray', d => d.type === 'prerequisite' ? 'none' : '4,4')
      .attr('marker-end', d => d.type === 'prerequisite' ? 'url(#arrowhead)' : '');

    const getColor = (d: Node) => {
      if (d.status === 'mastered') return '#22c55e';
      if (d.status === 'learning') return '#eab308';
      if (d.status === 'weak') return '#ef4444';
      return '#d1d5db';
    };

    const getStroke = (d: Node) => {
      if (d.status === 'mastered') return '#16a34a';
      if (d.status === 'learning') return '#ca8a04';
      if (d.status === 'weak') return '#dc2626';
      return '#9ca3af';
    };

    // Node groups (circle + text together)
    const nodeGroup = svg.append('g')
      .selectAll('g')
      .data(nodes)
      .join('g')
      .style('cursor', 'pointer');

    nodeGroup.append('circle')
      .attr('r', d => 10 + (d.mastery / 100) * 15)
      .style('fill', getColor)
      .style('stroke', getStroke)
      .style('stroke-width', 2)
      .style('opacity', d => d.status === 'not_started' ? 0.5 : 0.9);

    // Mastery % inside node
    nodeGroup.append('text')
      .text(d => d.status === 'not_started' ? '?' : `${d.mastery}`)
      .attr('text-anchor', 'middle')
      .attr('dy', '0.35em')
      .attr('font-size', '10px')
      .attr('font-weight', 'bold')
      .attr('fill', d => d.status === 'not_started' ? '#6b7280' : 'white');

    // Labels next to nodes
    const label = svg.append('g')
      .selectAll('text')
      .data(nodes)
      .join('text')
      .text(d => d.title)
      .attr('font-size', '11px')
      .attr('dx', d => 14 + (d.mastery / 100) * 15)
      .attr('dy', 4)
      .attr('fill', '#374151');

    // Tooltip
    const tooltip = d3.select('body').append('div')
      .style('position', 'absolute')
      .style('background', 'white')
      .style('border', '1px solid #e5e7eb')
      .style('border-radius', '8px')
      .style('padding', '8px 12px')
      .style('font-size', '12px')
      .style('box-shadow', '0 4px 6px rgba(0,0,0,0.1)')
      .style('pointer-events', 'none')
      .style('opacity', 0)
      .style('z-index', '1000');

    nodeGroup.on('mouseover', function(event, d) {
      d3.select(this).select('circle')
        .transition().duration(200)
        .attr('r', (10 + (d.mastery / 100) * 15) * 1.3);

      tooltip.style('opacity', 1)
        .html(`
          <strong>${d.title}</strong><br/>
          Mastery: ${d.mastery}%<br/>
          Status: ${d.status.replace('_', ' ')}<br/>
          ${d.lastReviewed ? `Last reviewed: ${d.lastReviewed}` : 'Not yet reviewed'}<br/>
          ${d.decayRate > 0 ? `Decay in: ${d.decayRate} days` : ''}
        `)
        .style('left', (event.pageX + 15) + 'px')
        .style('top', (event.pageY - 10) + 'px');
    }).on('mouseout', function(event, d) {
      d3.select(this).select('circle')
        .transition().duration(200)
        .attr('r', 10 + (d.mastery / 100) * 15);
      tooltip.style('opacity', 0);
    });

    // Drag
    const drag = d3.drag<SVGGElement, Node>()
      .on('start', (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    nodeGroup.call(drag as any);

    simulation.on('tick', () => {
      link
        .attr('x1', d => (d.source as unknown as Node).x ?? 0)
        .attr('y1', d => (d.source as unknown as Node).y ?? 0)
        .attr('x2', d => (d.target as unknown as Node).x ?? 0)
        .attr('y2', d => (d.target as unknown as Node).y ?? 0);

      nodeGroup.attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0})`);

      label
        .attr('x', d => d.x ?? 0)
        .attr('y', d => d.y ?? 0);
    });

    return () => { tooltip.remove(); };
  }, []);

  return (
    <div className="w-full h-full relative">
      <svg ref={svgRef} className="w-full h-full" />
      <div className="absolute bottom-3 left-3 bg-white/90 border rounded-lg p-2 text-xs flex gap-4">
        <div className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-green-500 inline-block" /> Mastered</div>
        <div className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-yellow-500 inline-block" /> Learning</div>
        <div className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-red-500 inline-block" /> Weak</div>
        <div className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-gray-300 inline-block" /> Not Started</div>
      </div>
    </div>
  );
};

export default KnowledgeGraph;
