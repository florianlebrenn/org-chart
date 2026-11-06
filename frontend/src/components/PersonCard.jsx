import { useContext } from "react";
import { ChevronDown, ChevronUp, Mail, Phone } from "lucide-react";
import { ChartContext } from "./chartContext.js";
import { initials } from "../core/text.js";

export function Avatar({ person, color, size = 36 }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.36) };
  if (person.photo) {
    return <img src={person.photo} alt="" style={style} className="shrink-0 rounded-full object-cover" draggable={false} />;
  }
  return (
    <span style={{ ...style, backgroundColor: color }} className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white">
      {initials(person.name)}
    </span>
  );
}

/** Carte d'un collaborateur dans l'organigramme (glisser-déposer, repli, sélection). */
export default function PersonCard({ person, childCount = 0 }) {
  const ctx = useContext(ChartContext);
  const color = ctx.colorOf(person);
  const collapsed = ctx.isCollapsed(person.id);
  const isDropTarget = ctx.dropTargetId === person.id;
  const isDragged = ctx.dragId === person.id;
  const contact = person.phone || person.email;

  return (
    <div
      data-testid="person-card"
      data-person-id={person.id}
      data-person-name={person.name}
      draggable={ctx.editable}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", String(person.id));
        e.dataTransfer.effectAllowed = "move";
        ctx.startDrag(person.id);
      }}
      onDragEnd={ctx.endDrag}
      onDragOver={(e) => {
        if (ctx.canDropOn(person.id)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          ctx.setDropTarget(person.id);
        }
      }}
      onDragLeave={() => isDropTarget && ctx.setDropTarget(null)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        ctx.dropOn(person.id);
      }}
      onClick={() => ctx.select(person.id)}
      title={ctx.editable ? "Cliquer pour le détail · glisser sur une autre carte pour changer le supérieur" : ""}
      className={`oc-card group relative flex cursor-pointer items-center gap-2.5 rounded-xl border bg-white px-2.5 text-left shadow-sm transition
        ${person.hit ? "ring-2 ring-amber-400" : ""}
        ${ctx.selectedId === person.id ? "ring-2 ring-slate-900" : ""}
        ${isDropTarget ? "ring-2 ring-emerald-500 bg-emerald-50" : ""}
        ${isDragged ? "opacity-40" : ""}`}
      style={{ borderLeft: `4px solid ${color}` }}
    >
      <Avatar person={person} color={color} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold leading-tight text-slate-800">{person.name}</div>
        {person.title && <div className="line-clamp-2 text-[11px] leading-tight text-slate-500">{person.title}</div>}
        {person.note ? (
          <div className="truncate text-[10px] leading-tight text-amber-700">{person.note}</div>
        ) : (
          contact && (
            <div className="flex items-center gap-1 truncate text-[10px] leading-tight text-slate-400">
              {person.phone ? <Phone size={9} /> : <Mail size={9} />} <span className="truncate">{contact}</span>
            </div>
          )
        )}
      </div>
      {childCount > 0 && (
        <button
          className="flex h-6 shrink-0 items-center gap-0.5 self-center rounded-full border bg-white px-1.5 text-[10px] text-slate-500 hover:bg-slate-100"
          onClick={(e) => {
            e.stopPropagation();
            ctx.toggle(person.id);
          }}
          aria-label={collapsed ? `Déplier (${childCount})` : `Replier (${childCount})`}
          title={collapsed ? "Déplier l'équipe" : "Replier l'équipe"}
        >
          {childCount} {collapsed ? <ChevronDown size={11} /> : <ChevronUp size={11} />}
        </button>
      )}
    </div>
  );
}
