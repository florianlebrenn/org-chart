import { useContext } from "react";
import { ChartContext } from "./chartContext.js";
import PersonCard from "./PersonCard.jsx";
import { layoutItems } from "../core/tree.js";

// Organigramme « de haut en bas ». Les traits sont dessinés en CSS (voir .oc-* dans index.css).
// Règle commune avec le PDF (layoutItems) : les personnes sans équipe sont empilées en colonnes.
function ChartNode({ node }) {
  const ctx = useContext(ChartContext);
  const kids = node.reports;
  const collapsed = ctx.isCollapsed(node.id);
  return (
    <div className="oc-node">
      <PersonCard person={node} childCount={kids.length} />
      {kids.length > 0 && !collapsed && (
        <div className="oc-children">
          {layoutItems(node).map((item) =>
            item.type === "node" ? (
              <div key={item.node.id} className="oc-child">
                <ChartNode node={item.node} />
              </div>
            ) : (
              <div key={`col-${item.nodes[0].id}`} className="oc-child">
                <div className="oc-col">
                  {item.nodes.map((k) => <PersonCard key={k.id} person={k} />)}
                </div>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}

export default function OrgChart({ trees }) {
  if (!trees.length) return null;
  return (
    <div className="oc-forest">
      {trees.map((t) => (
        <ChartNode key={t.id} node={t} />
      ))}
    </div>
  );
}
