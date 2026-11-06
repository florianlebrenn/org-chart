import { useContext } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ChartContext } from "./chartContext.js";
import { Avatar } from "./PersonCard.jsx";

// Vue « liste » : l'arbre repliable indenté du fork org.chart, avec les nouvelles données.
function Row({ node, depth }) {
  const ctx = useContext(ChartContext);
  const kids = node.reports || [];
  const collapsed = ctx.isCollapsed(node.id);
  const color = ctx.colorOf(node);
  return (
    <>
      <div
        data-testid="list-row"
        onClick={() => ctx.select(node.id)}
        className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50 ${
          node.hit ? "bg-amber-50" : ""
        } ${ctx.selectedId === node.id ? "ring-1 ring-slate-900" : ""}`}
        style={{ paddingLeft: 8 + depth * 22 }}
      >
        <button
          className={`rounded p-0.5 ${kids.length ? "text-slate-500 hover:bg-slate-200" : "invisible"}`}
          onClick={(e) => {
            e.stopPropagation();
            ctx.toggle(node.id);
          }}
          aria-label={collapsed ? "Déplier" : "Replier"}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
        </button>
        <Avatar person={node} color={color} size={28} />
        <div className="min-w-0 flex-1">
          <span className="font-medium text-slate-800">{node.name}</span>
          {node.title && <span className="text-sm text-slate-500"> · {node.title}</span>}
          {node.note && <span className="text-xs text-amber-700"> · {node.note}</span>}
        </div>
        {kids.length > 0 && <span className="rounded-full bg-slate-100 px-2 text-xs text-slate-500">{kids.length}</span>}
        {node.site && (
          <span className="hidden truncate rounded-full px-2 text-[11px] text-white sm:inline" style={{ backgroundColor: color }}>
            {node.site}
          </span>
        )}
        <span className="hidden w-48 truncate text-right text-xs text-slate-400 md:inline">{node.phone || node.email}</span>
      </div>
      {!collapsed && kids.map((k) => <Row key={k.id} node={k} depth={depth + 1} />)}
    </>
  );
}

export default function OrgList({ nodes }) {
  return (
    <div className="space-y-0.5">
      {nodes.map((n) => (
        <Row key={n.id} node={n} depth={0} />
      ))}
    </div>
  );
}
