import { researchData, type ResearchId } from "../../data";
import { useT } from "../../i18n";
import { researchAvailable } from "../../sim";
import { useGameStore } from "../../state/store";
import { formatMoney } from "../format";

/** Экран «Исследования» (этап 11, DESIGN.md §9). */
export function ResearchScreen(): React.JSX.Element {
  const t = useT();
  const language = useGameStore((state) => state.settings.game.language);
  const numberFormat = useGameStore((state) => state.settings.game.numberFormat);
  const game = useGameStore((state) => state.game);
  const startResearch = useGameStore((state) => state.startResearch);
  const cancelResearch = useGameStore((state) => state.cancelResearch);

  const completed = game.research.completed;
  const active = game.research.active;
  const hour = game.time.hour;

  return (
    <>
      <section className="panel panel--wide">
        <div className="panel__label">{t("research.title")}</div>
        <p className="panel__hint">{t("research.intro")}</p>
        <div className="econ-rows">
          <div className="econ-row">
            <span className="econ-row__label">{t("research.activeCount")}</span>
            <span className="econ-row__value">
              {active.length} / {researchData.rules.maxActive}
            </span>
          </div>
          <div className="econ-row">
            <span className="econ-row__label">{t("research.completedCount")}</span>
            <span className="econ-row__value">
              {completed.length} / {researchData.projects.length}
            </span>
          </div>
        </div>
      </section>

      {active.length > 0 && (
        <section className="panel panel--wide">
          <div className="panel__label">{t("research.activeTitle")}</div>
          <div className="loc-options">
            {active.map((entry) => {
              const project = researchData.projects.find((p) => p.id === entry.id)!;
              const hoursLeft = Math.max(0, entry.completesAtHour - hour);
              return (
                <article className="loc-option" key={entry.id}>
                  <div className="loc-option__head">
                    <strong>{t(`research.name.${entry.id}`)}</strong>
                    <span className="badge" data-state="warn">
                      {t("research.daysLeft", { days: Math.ceil(hoursLeft / 24) })}
                    </span>
                  </div>
                  <div className="loc-option__specs">
                    <span>{t(`research.effect.${entry.id}`)}</span>
                  </div>
                  <button
                    type="button"
                    className="btn btn--small"
                    onClick={() => cancelResearch(entry.id)}
                  >
                    {t("research.cancel", {
                      refund: formatMoney(
                        Math.round(project.cost * researchData.rules.cancelRefundMult),
                        language,
                        numberFormat,
                      ),
                    })}
                  </button>
                </article>
              );
            })}
          </div>
        </section>
      )}

      <section className="panel panel--wide">
        <div className="panel__label">{t("research.availableTitle")}</div>
        <div className="loc-options">
          {researchData.projects
            .filter(
              (project) =>
                !completed.includes(project.id) &&
                !active.some((entry) => entry.id === project.id),
            )
            .map((project) => {
              const available = researchAvailable(game, project.id as ResearchId);
              return (
                <article className="loc-option" key={project.id} data-current={completed.includes(project.id)}>
                  <div className="loc-option__head">
                    <strong>{t(`research.name.${project.id}`)}</strong>
                    <span className="loc-option__price">
                      {formatMoney(project.cost, language, numberFormat)}
                    </span>
                  </div>
                  <div className="loc-option__specs">
                    <span>{t(`research.effect.${project.id}`)}</span>
                    <span>
                      {t("research.duration", { days: project.days })}
                      {project.prerequisites.length > 0 && (
                        <>
                          {" · "}
                          {t("research.prereq", {
                            list: project.prerequisites
                              .map((p) => t(`research.name.${p}`))
                              .join(", "),
                          })}
                        </>
                      )}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn btn--small btn--primary"
                    disabled={!available || game.money < project.cost}
                    onClick={() => startResearch(project.id)}
                  >
                    {available
                      ? t("research.start")
                      : t("research.locked")}
                  </button>
                </article>
              );
            })}
        </div>
      </section>

      {completed.length > 0 && (
        <section className="panel">
          <div className="panel__label">{t("research.completedTitle")}</div>
          <ul className="loc-option__specs">
            {completed.map((id) => (
              <li key={id}>
                <span className="badge" data-state="ok">
                  ✓
                </span>{" "}
                {t(`research.name.${id}`)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
