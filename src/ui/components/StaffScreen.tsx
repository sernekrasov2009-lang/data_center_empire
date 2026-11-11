import { staffData } from "../../data";
import { useT } from "../../i18n";
import { effectStrength, monthlyPayroll, severanceFor } from "../../sim";
import { useGameStore } from "../../state/store";
import { formatMoney } from "../format";

/** Экран «Персонал» (этап 10, DESIGN.md §8). */
export function StaffScreen(): React.JSX.Element {
  const t = useT();
  const language = useGameStore((state) => state.settings.game.language);
  const numberFormat = useGameStore((state) => state.settings.game.numberFormat);
  const game = useGameStore((state) => state.game);
  const hireStaff = useGameStore((state) => state.hireStaff);
  const fireStaff = useGameStore((state) => state.fireStaff);

  const employees = game.staff.employees;
  const payroll = monthlyPayroll(game);

  return (
    <>
      <section className="panel panel--wide">
        <div className="panel__label">{t("staff.title")}</div>
        <p className="panel__hint">{t("staff.intro")}</p>
        <div className="econ-rows">
          <div className="econ-row">
            <span className="econ-row__label">{t("staff.payroll")}</span>
            <span className="econ-row__value">
              {formatMoney(-payroll, language, numberFormat)}
            </span>
          </div>
          <div className="econ-row">
            <span className="econ-row__label">{t("staff.employees")}</span>
            <span className="econ-row__value">
              {employees.length} / {staffData.roles.length}
            </span>
          </div>
        </div>
      </section>

      <section className="panel panel--wide">
        <div className="panel__label">{t("staff.hiring")}</div>
        <div className="loc-options">
          {staffData.roles.map((role) => {
            const employee = employees.find(
              (candidate) => candidate.roleId === role.id,
            );
            const fee = Math.round(role.salaryPerMonth * staffData.hiring.feeMult);
            return (
              <article className="loc-option" key={role.id} data-current={employee !== undefined}>
                <div className="loc-option__head">
                  <strong>{t(`staff.role.${role.id}`)}</strong>
                  {employee ? (
                    <span className="badge" data-state="ok">
                      {t("staff.level", { level: employee.level })}
                    </span>
                  ) : (
                    <span className="loc-option__price">
                      {formatMoney(role.salaryPerMonth, language, numberFormat)}/
                      {t("staff.perMonth")}
                    </span>
                  )}
                </div>
                <div className="loc-option__specs">
                  <span>{t(`staff.roleDesc.${role.id}`)}</span>
                </div>
                {employee ? (
                  <button
                    type="button"
                    className="btn btn--small"
                    onClick={() => fireStaff(employee.id)}
                  >
                    {t("staff.fire", {
                      cost: formatMoney(severanceFor(employee), language, numberFormat),
                    })}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn--small btn--primary"
                    disabled={game.money < fee}
                    onClick={() => hireStaff(role.id)}
                  >
                    {t("staff.hire", { cost: formatMoney(fee, language, numberFormat) })}
                  </button>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <div className="panel__label">{t("staff.effects")}</div>
        <div className="econ-rows">
          {(
            [
              ["repairSpeed", "staff.effect.repairSpeed"],
              ["channelResilience", "staff.effect.channelResilience"],
              ["powerResilience", "staff.effect.powerResilience"],
              ["supportScore", "staff.effect.supportScore"],
              ["demandBoost", "staff.effect.demandBoost"],
              ["hackProtection", "staff.effect.hackProtection"],
            ] as const
          ).map(([effect, key]) => {
            const strength = effectStrength(game, effect);
            return (
              <div className="econ-row" key={effect}>
                <span className="econ-row__label">{t(key)}</span>
                <span className="econ-row__value">
                  {t("staff.effectValue", { value: Math.round(strength * 100) })}
                </span>
              </div>
            );
          })}
        </div>
        <p className="panel__hint">{t("staff.effectsHint")}</p>
      </section>
    </>
  );
}
