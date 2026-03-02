'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { useRouter } from 'next/navigation';

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

interface KnowledgeGraphProps {
  nodes?: Node[];
  links?: Link[];
  showLabels?: boolean;
}

const KnowledgeGraph = ({ nodes = [], links = [], showLabels = false }: KnowledgeGraphProps) => {
  const router = useRouter();
  const svgRef = useRef<SVGSVGElement>(null);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);

  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    const graphNodes = nodes.map((n) => ({ ...n }));
    const graphLinks = links.map((l) => {
      const sourceId = typeof l.source === 'string' ? l.source : String((l.source as Node).id);
      const targetId = typeof l.target === 'string' ? l.target : String((l.target as Node).id);
      return { ...l, source: sourceId, target: targetId };
    });

    const inDegreeMap = new Map<string, number>();
    const outDegreeMap = new Map<string, number>();
    for (const node of graphNodes) {
      inDegreeMap.set(node.id, 0);
      outDegreeMap.set(node.id, 0);
    }
    for (const link of graphLinks) {
      const sourceId = String(link.source);
      const targetId = String(link.target);
      outDegreeMap.set(sourceId, (outDegreeMap.get(sourceId) ?? 0) + 1);
      inDegreeMap.set(targetId, (inDegreeMap.get(targetId) ?? 0) + 1);
    }
    const isStartPointNode = (d: Node) =>
      (inDegreeMap.get(d.id) ?? 0) === 0 && (outDegreeMap.get(d.id) ?? 0) > 0;
    if (graphNodes.length === 0) {
      return;
    }

    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;

    // ── Defs: arrowhead ───────────────────────────────────────────────────────────
    const defs = svg.append('defs');

    defs.append('marker')
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

    const ballColors: Record<Node['status'], { fill: string; stroke: string; text: string }> = {
      mastered: { fill: '#22c55e', stroke: '#15803d', text: '#14532d' },
      learning: { fill: '#eab308', stroke: '#a16207', text: '#713f12' },
      weak: { fill: '#ef4444', stroke: '#b91c1c', text: '#7f1d1d' },
      not_started: { fill: '#d1d5db', stroke: '#6b7280', text: '#374151' },
    };

    const simulation = d3.forceSimulation<Node>(graphNodes)
      .force('link', d3.forceLink<Node, Link>(graphLinks).id(d => d.id).distance(100))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(35));

    // Links
    const link = svg.append('g')
      .selectAll('line')
      .data(graphLinks)
      .join('line')
      .style('stroke', d => d.type === 'prerequisite' ? '#94a3b8' : '#e2e8f0')
      .style('stroke-width', d => d.type === 'prerequisite' ? 2 : 1)
      .style('stroke-dasharray', d => d.type === 'prerequisite' ? 'none' : '4,4')
      .attr('marker-end', d => d.type === 'prerequisite' ? 'url(#arrowhead)' : '');

    const nodeR = (d: Node) => 14 + (d.mastery / 100) * 12;

    // Node groups (minimal flat circles + centered number)
    const nodeGroup = svg.append('g')
      .selectAll('g')
      .data(graphNodes)
      .join('g')
      .style('cursor', 'pointer');

    // Suggested start-point ring (nodes with no incoming edges)
    nodeGroup.append('circle')
      .attr('class', 'edge-node-ring')
      .attr('r', d => nodeR(d) + 4)
      .style('fill', 'none')
      .style('stroke', '#0ea5e9')
      .style('stroke-width', d => isStartPointNode(d) ? 1.8 : 0)
      .style('stroke-dasharray', '3,2')
      .style('opacity', d => isStartPointNode(d) ? 0.95 : 0);

    // Main ball body
    nodeGroup.append('circle')
      .attr('class', 'node-body')
      .attr('r', nodeR)
      .style('fill', d => (
        isStartPointNode(d) && d.status === 'not_started' ? '#dbeafe' : ballColors[d.status].fill
      ))
      .style('fill-opacity', 0.78)
      .style('stroke', d => (
        isStartPointNode(d) && d.status === 'not_started' ? '#0284c7' : ballColors[d.status].stroke
      ))
      .style('stroke-width', d => isStartPointNode(d) ? 2.2 : 1.6);

    // Mastery number centered
    nodeGroup.append('text')
      .text(d => d.status === 'not_started' ? '?' : `${d.mastery}`)
      .attr('text-anchor', 'middle')
      .attr('dy', '0.38em')
      .attr('font-size', d => `${Math.max(9, nodeR(d) * 0.42)}px`)
      .attr('font-weight', 'bold')
      .attr('font-family', 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial')
      .attr('fill', d => (
        isStartPointNode(d) && d.status === 'not_started' ? '#0c4a6e' : ballColors[d.status].text
      ))
      .style('pointer-events', 'none');

    // Labels next to nodes
    const label = svg.append('g')
      .attr('display', showLabels ? null : 'none')
      .selectAll('text')
      .data(graphNodes)
      .join('text')
      .text(d => d.title)
      .attr('font-size', '11px')
      .attr('dx', d => nodeR(d) + 6)
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
      const group = d3.select(this);
      group.select<SVGCircleElement>('.node-body')
        .transition()
        .duration(140)
        .style('stroke-width', isStartPointNode(d) ? 3 : 2.4);

      tooltip.style('opacity', 1)
        .html(`
          <strong>${d.title}</strong><br/>
          Mastery: ${d.mastery}%<br/>
          Status: ${d.status.replace('_', ' ')}<br/>
          ${isStartPointNode(d) ? 'Suggested start point<br/>' : ''}
          ${d.lastReviewed ? `Last reviewed: ${d.lastReviewed}` : 'Not yet reviewed'}<br/>
          ${d.decayRate > 0 ? `Decay in: ${d.decayRate} days` : ''}
        `)
        .style('left', (event.pageX + 15) + 'px')
        .style('top', (event.pageY - 10) + 'px');
    }).on('mouseout', function(_, d) {
      const group = d3.select(this);
      group.select<SVGCircleElement>('.node-body')
        .transition()
        .duration(140)
        .style('stroke-width', isStartPointNode(d) ? 2.2 : 1.6);
      tooltip.style('opacity', 0);
    }).on('click', function(_, d) {
      setSelectedNode(d);
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

    const pad = 30;
    simulation.on('tick', () => {
      // Clamp nodes inside the SVG boundaries
      graphNodes.forEach(d => {
        const r = nodeR(d);
        d.x = Math.max(r + pad, Math.min(width - r - pad, d.x ?? width / 2));
        d.y = Math.max(r + pad, Math.min(height - r - pad, d.y ?? height / 2));
      });

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
  }, [nodes, links, showLabels]);

  return (
    <div className="w-full h-full relative">
      <svg ref={svgRef} className="w-full h-full" />
      <div className="absolute bottom-3 left-3 bg-card/90 border rounded-lg p-2 text-xs flex gap-4">
        <div className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-green-500 inline-block" /> Mastered</div>
        <div className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-yellow-500 inline-block" /> Learning</div>
        <div className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-red-500 inline-block" /> Weak</div>
        <div className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-gray-300 inline-block" /> Not Started</div>
        <div className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-full border-2 border-sky-500 border-dashed inline-block" />
          Suggested Start Points
        </div>
      </div>

      {selectedNode && (
        <div
          className="absolute inset-0 z-20 bg-black/30 flex items-center justify-center p-4"
          onClick={() => setSelectedNode(null)}
        >
          <div
            className="w-full max-w-md rounded-xl bg-white border border-gray-200 shadow-xl p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-500">Selected Topic</p>
                <h3 className="text-lg font-semibold text-gray-900">{selectedNode.title}</h3>
                <p className="text-sm text-gray-500 mt-1">
                  Mastery {selectedNode.mastery}% • {selectedNode.status.replace('_', ' ')}
                </p>
              </div>
              <button
                type="button"
                className="text-gray-400 hover:text-gray-600"
                onClick={() => setSelectedNode(null)}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                type="button"
                className="rounded-lg border border-violet-300 bg-violet-50 px-3 py-2 text-sm font-medium text-violet-700 hover:bg-violet-100"
                onClick={() => {
                  const params = new URLSearchParams({
                    topic: selectedNode.title,
                    conceptId: selectedNode.id,
                    subject: selectedNode.category || 'Knowledge Map',
                  });
                  router.push(`/assessment/${encodeURIComponent(selectedNode.id)}/intro?${params.toString()}`);
                }}
              >
                Go To Assessment
              </button>
              <button
                type="button"
                className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100"
                onClick={() => {
                  const params = new URLSearchParams({
                    topic: selectedNode.title,
                    conceptId: selectedNode.id,
                    subject: selectedNode.category || 'Knowledge Map',
                  });
                  router.push(`/ai-assistant?${params.toString()}`);
                }}
              >
                Go To Socratic Tutor
              </button>
              <button
                type="button"
                className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100"
                onClick={() => {
                  const params = new URLSearchParams({
                    topic: selectedNode.title,
                    conceptId: selectedNode.id,
                    subject: selectedNode.category || 'Knowledge Map',
                  });
                  router.push(`/groups?${params.toString()}`);
                }}
              >
                Go To Peer Hubs
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default KnowledgeGraph;
