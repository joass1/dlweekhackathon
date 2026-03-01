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

interface KnowledgeGraphProps {
  nodes?: Node[];
  links?: Link[];
}

const KnowledgeGraph = ({ nodes = [], links = [] }: KnowledgeGraphProps) => {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    const graphNodes = [...nodes];
    const graphLinks = [...links];
    if (graphNodes.length === 0) {
      return;
    }

    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;

    // ── Defs: arrowhead + retro ball gradients ──────────────────────────────────
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

    // Retro glossy ball gradients — one per status
    const ballColors: Record<string, { base: string; light: string; dark: string }> = {
      mastered:    { base: '#22c55e', light: '#86efac', dark: '#15803d' },
      learning:    { base: '#eab308', light: '#fde68a', dark: '#a16207' },
      weak:        { base: '#ef4444', light: '#fca5a5', dark: '#b91c1c' },
      not_started: { base: '#d1d5db', light: '#f3f4f6', dark: '#6b7280' },
    };

    Object.entries(ballColors).forEach(([status, c]) => {
      // Main body gradient — radial with glossy highlight
      const grad = defs.append('radialGradient')
        .attr('id', `ball-${status}`)
        .attr('cx', '35%').attr('cy', '30%')
        .attr('r', '65%')
        .attr('fx', '30%').attr('fy', '25%');
      grad.append('stop').attr('offset', '0%').attr('stop-color', c.light).attr('stop-opacity', 0.95);
      grad.append('stop').attr('offset', '50%').attr('stop-color', c.base).attr('stop-opacity', 0.80);
      grad.append('stop').attr('offset', '100%').attr('stop-color', c.dark).attr('stop-opacity', 0.70);

      // Specular highlight — small white spot
      const spec = defs.append('radialGradient')
        .attr('id', `shine-${status}`)
        .attr('cx', '35%').attr('cy', '25%')
        .attr('r', '35%')
        .attr('fx', '35%').attr('fy', '20%');
      spec.append('stop').attr('offset', '0%').attr('stop-color', '#ffffff').attr('stop-opacity', 0.7);
      spec.append('stop').attr('offset', '100%').attr('stop-color', '#ffffff').attr('stop-opacity', 0);
    });

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

    const getStroke = (d: Node) => {
      if (d.status === 'mastered') return '#15803d';
      if (d.status === 'learning') return '#a16207';
      if (d.status === 'weak') return '#b91c1c';
      return '#6b7280';
    };

    const nodeR = (d: Node) => 14 + (d.mastery / 100) * 12;
    const statusSprite: Partial<Record<Node['status'], string>> = {
      mastered: '/green-ball.png',
      learning: '/yellow-ball.png',
      weak: '/red-ball.png',
      not_started: '/grey-ball.png',
    };
    const hasSprite = (d: Node) => Boolean(statusSprite[d.status]);

    // Node groups (retro ball + shine + number)
    const nodeGroup = svg.append('g')
      .selectAll('g')
      .data(graphNodes)
      .join('g')
      .style('cursor', 'pointer');

    // Outer shadow/glow
    nodeGroup.append('circle')
      .attr('r', d => nodeR(d) + 3)
      .style('fill', 'none')
      .style('stroke', d => ballColors[d.status].base)
      .style('stroke-width', 1.5)
      .style('stroke-opacity', 0.3)
      .style('filter', 'blur(2px)');

    // Main ball body — glossy radial gradient, semi-transparent
    nodeGroup.append('circle')
      .attr('r', nodeR)
      .style('fill', d => `url(#ball-${d.status})`)
      .style('stroke', getStroke)
      .style('stroke-width', 2.5)
      .style('opacity', d => (hasSprite(d) ? 0.12 : d.status === 'not_started' ? 0.55 : 0.78));

    // Pixel-art sprites for mastered/learning/weak concepts
    nodeGroup
      .filter(d => hasSprite(d))
      .append('image')
      .attr('class', 'status-ball-sprite')
      .attr('href', d => statusSprite[d.status] ?? '')
      .attr('x', d => -nodeR(d))
      .attr('y', d => -nodeR(d))
      .attr('width', d => nodeR(d) * 2)
      .attr('height', d => nodeR(d) * 2)
      .style('image-rendering', 'pixelated')
      .style('pointer-events', 'none');

    // Specular highlight overlay
    nodeGroup.append('circle')
      .attr('r', d => nodeR(d) * 0.85)
      .attr('cx', d => -nodeR(d) * 0.12)
      .attr('cy', d => -nodeR(d) * 0.15)
      .style('fill', d => `url(#shine-${d.status})`)
      .style('opacity', d => (hasSprite(d) ? 0 : 1))
      .style('pointer-events', 'none');

    // White number circle (retro ball number spot)
    nodeGroup.append('circle')
      .attr('r', d => nodeR(d) * 0.45)
      .style('fill', '#ffffff')
      .style('fill-opacity', 0.85)
      .style('stroke', 'none')
      .style('pointer-events', 'none');

    // Mastery number inside the white spot
    nodeGroup.append('text')
      .text(d => d.status === 'not_started' ? '?' : `${d.mastery}`)
      .attr('text-anchor', 'middle')
      .attr('dy', '0.38em')
      .attr('font-size', d => `${Math.max(9, nodeR(d) * 0.45)}px`)
      .attr('font-weight', 'bold')
      .attr('font-family', '"Courier New", monospace')
      .attr('fill', d => ballColors[d.status].dark)
      .style('pointer-events', 'none');

    // Labels next to nodes
    const label = svg.append('g')
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
      d3.select(this).selectAll('circle')
        .transition().duration(150)
        .attr('r', function() {
          const current = parseFloat(d3.select(this).attr('r'));
          return current * 1.2;
        });
      d3.select(this).select('.status-ball-sprite')
        .transition().duration(150)
        .attr('x', -nodeR(d) * 1.2)
        .attr('y', -nodeR(d) * 1.2)
        .attr('width', nodeR(d) * 2.4)
        .attr('height', nodeR(d) * 2.4);

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
    }).on('mouseout', function(_, d) {
      const r = nodeR(d);
      const group = d3.select(this);
      // Reset each circle to its original radius
      group.select('circle:nth-child(1)').transition().duration(150).attr('r', r + 3);
      group.select('circle:nth-child(2)').transition().duration(150).attr('r', r);
      group.select('circle:nth-child(3)').transition().duration(150).attr('r', r * 0.85);
      group.select('circle:nth-child(4)').transition().duration(150).attr('r', r * 0.45);
      group.select('.status-ball-sprite')
        .transition().duration(150)
        .attr('x', -r)
        .attr('y', -r)
        .attr('width', r * 2)
        .attr('height', r * 2);
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
  }, [nodes, links]);

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
