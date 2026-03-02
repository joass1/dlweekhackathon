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
      .attr('fill', '#cbd5e1');

    const ballColors: Record<Node['status'], { fill: string; stroke: string; text: string }> = {
      mastered: { fill: '#34d399', stroke: '#059669', text: '#ffffff' },
      learning: { fill: '#fbbf24', stroke: '#d97706', text: '#ffffff' },
      weak: { fill: '#f87171', stroke: '#dc2626', text: '#ffffff' },
      not_started: { fill: '#94a3b8', stroke: '#64748b', text: '#ffffff' },
    };

    const simulation = d3.forceSimulation<Node>(graphNodes)
      .force('link', d3.forceLink<Node, Link>(graphLinks).id(d => d.id).distance(100))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(38));

    // Links
    const link = svg.append('g')
      .selectAll('line')
      .data(graphLinks)
      .join('line')
      .style('stroke', d => d.type === 'prerequisite' ? '#cbd5e1' : '#94a3b8')
      .style('stroke-width', d => d.type === 'prerequisite' ? 2.2 : 1.2)
      .style('stroke-dasharray', d => d.type === 'prerequisite' ? 'none' : '4,4')
      .attr('marker-end', d => d.type === 'prerequisite' ? 'url(#arrowhead)' : '');

    const nodeR = (d: Node) => 15.4 + (d.mastery / 100) * 13.2;

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
        isStartPointNode(d) && d.status === 'not_started' ? '#38bdf8' : ballColors[d.status].fill
      ))
      .style('fill-opacity', 0.9)
      .style('stroke', d => (
        isStartPointNode(d) && d.status === 'not_started' ? '#0ea5e9' : ballColors[d.status].stroke
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
        isStartPointNode(d) && d.status === 'not_started' ? '#ffffff' : ballColors[d.status].text
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
      .attr('fill', '#e2e8f0');

    // Tooltip
    const tooltip = d3.select('body').append('div')
      .style('position', 'absolute')
      .style('background', 'rgba(15, 23, 42, 0.85)')
      .style('backdrop-filter', 'blur(4px)')
      .style('border', '1px solid rgba(255,255,255,0.15)')
      .style('border-radius', '8px')
      .style('padding', '8px 12px')
      .style('font-size', '12px')
      .style('color', 'rgba(255,255,255,0.9)')
      .style('box-shadow', '0 4px 12px rgba(0,0,0,0.3)')
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
      <div className="absolute bottom-3 left-3 bg-slate-900/80 backdrop-blur-sm border border-white/20 rounded-lg p-2 text-xs text-white/80 flex gap-4">
        <div className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-emerald-400 inline-block" /> Mastered</div>
        <div className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-amber-400 inline-block" /> Learning</div>
        <div className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-red-400 inline-block" /> Weak</div>
        <div className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-slate-400 inline-block" /> Not Started</div>
        <div className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-full border-2 border-sky-400 border-dashed inline-block" />
          Suggested Start
        </div>
      </div>

      {selectedNode && (
        <div
          className="absolute inset-0 z-20 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setSelectedNode(null)}
        >
          <div
            className="w-full max-w-md rounded-xl bg-slate-900/80 backdrop-blur-sm border border-white/20 shadow-xl p-5 text-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-white/50">Selected Topic</p>
                <h3 className="text-lg font-semibold text-white">{selectedNode.title}</h3>
                <p className="text-sm text-white/60 mt-1">
                  Mastery {selectedNode.mastery}% • {selectedNode.status.replace('_', ' ')}
                </p>
              </div>
              <button
                type="button"
                className="text-white/40 hover:text-white/80 transition-colors"
                onClick={() => setSelectedNode(null)}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                type="button"
                className="rounded-lg border border-violet-400/30 bg-violet-500/20 px-3 py-2 text-sm font-medium text-violet-300 hover:bg-violet-500/30 transition-colors"
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
                className="rounded-lg border border-emerald-400/30 bg-emerald-500/20 px-3 py-2 text-sm font-medium text-emerald-300 hover:bg-emerald-500/30 transition-colors"
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
                className="rounded-lg border border-sky-400/30 bg-sky-500/20 px-3 py-2 text-sm font-medium text-sky-300 hover:bg-sky-500/30 transition-colors"
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
