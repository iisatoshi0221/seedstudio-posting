(function (root) {
  "use strict";

  const MILESTONE_STEPS = Object.freeze([
    10000,
    50000,
    100000,
    250000,
    500000
  ]);

  function normalizeNonNegativeNumber(value) {
    const numeric = Number(value);

    if (!Number.isFinite(numeric)) {
      return 0;
    }

    return Math.max(0, numeric);
  }

  function caloriesFromSteps(steps) {
    return Math.round(
      normalizeNonNegativeNumber(steps) * 0.05
    );
  }

  function isValidYm(value) {
    if (
      typeof value !== "string" ||
      !/^\d{4}-\d{2}$/.test(value)
    ) {
      return false;
    }

    const month = Number(value.slice(5, 7));

    return month >= 1 && month <= 12;
  }

  function isValidIsoDate(value) {
    if (
      typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value)
    ) {
      return false;
    }

    const [year, month, day] =
      value.split("-").map(Number);

    const date = new Date(
      Date.UTC(
        year,
        month - 1,
        day
      )
    );

    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }

  function previousYm(targetYm) {
    if (!isValidYm(targetYm)) {
      throw new Error(
        "targetYm must be YYYY-MM."
      );
    }

    const year =
      Number(targetYm.slice(0, 4));

    const month =
      Number(targetYm.slice(5, 7));

    if (month > 1) {
      return [
        String(year).padStart(4, "0"),
        String(month - 1).padStart(2, "0")
      ].join("-");
    }

    return [
      String(year - 1).padStart(4, "0"),
      "12"
    ].join("-");
  }

  function getParticipantEntrySummary(
    record,
    participantId
  ) {
    const participants =
      Array.isArray(record?.participants)
        ? record.participants
        : [];

    const matches =
      participants.filter(
        (participant) =>
          participant?.participantId ===
          participantId
      );

    return {
      present:
        matches.length > 0,

      steps:
        matches.reduce(
          (sum, participant) =>
            sum +
            normalizeNonNegativeNumber(
              participant?.steps
            ),
          0
        )
    };
  }

  function buildParticipantDailyStats(
    records,
    participantId
  ) {
    const dailyMap = new Map();

    (Array.isArray(records)
      ? records
      : []
    ).forEach(
      (record) => {
        const postingDate =
          record?.postingDate;

        if (
          !isValidIsoDate(
            postingDate
          )
        ) {
          if (
            postingDate !==
            undefined
          ) {
            console.warn(
              "Monthly report aggregation skipped an invalid postingDate.",
              postingDate
            );
          }

          return;
        }

        const participant =
          getParticipantEntrySummary(
            record,
            participantId
          );

        if (!participant.present) {
          return;
        }

        const existing =
          dailyMap.get(
            postingDate
          ) || {
            date:
              postingDate,

            steps:
              0,

            relatedQuantity:
              0,

            recordCount:
              0
          };

        existing.steps +=
          participant.steps;

        existing.relatedQuantity +=
          normalizeNonNegativeNumber(
            record?.quantity
          );

        existing.recordCount +=
          1;

        dailyMap.set(
          postingDate,
          existing
        );
      }
    );

    return [...dailyMap.values()]
      .sort(
        (a, b) =>
          a.date.localeCompare(
            b.date
          )
      );
  }

  function summarizeDailyStats(
    dailyStats
  ) {
    const stats =
      Array.isArray(dailyStats)
        ? dailyStats
        : [];

    const steps =
      stats.reduce(
        (sum, day) =>
          sum +
          normalizeNonNegativeNumber(
            day?.steps
          ),
        0
      );

    const participationDays =
      stats.length;

    const relatedQuantity =
      stats.reduce(
        (sum, day) =>
          sum +
          normalizeNonNegativeNumber(
            day?.relatedQuantity
          ),
        0
      );

    const bestDailySteps =
      stats.reduce(
        (best, day) =>
          Math.max(
            best,
            normalizeNonNegativeNumber(
              day?.steps
            )
          ),
        0
      );

    return {
      steps,

      participationDays,

      averageDailySteps:
        participationDays > 0
          ? Math.round(
              steps /
              participationDays
            )
          : 0,

      bestDailySteps,

      calories:
        caloriesFromSteps(
          steps
        ),

      relatedQuantity
    };
  }

  function buildMonthlyReportStats(
    records,
    participantId,
    targetYm
  ) {
    if (
      typeof participantId !==
        "string" ||
      !participantId.trim()
    ) {
      throw new Error(
        "participantId is required."
      );
    }

    if (!isValidYm(targetYm)) {
      throw new Error(
        "targetYm must be YYYY-MM."
      );
    }

    const normalizedParticipantId =
      participantId.trim();

    const dailyStats =
      buildParticipantDailyStats(
        records,
        normalizedParticipantId
      );

    const previousMonthYm =
      previousYm(
        targetYm
      );

    const monthlyDaily =
      dailyStats.filter(
        (day) =>
          day.date.slice(0, 7) ===
          targetYm
      );

    const previousMonthDaily =
      dailyStats.filter(
        (day) =>
          day.date.slice(0, 7) ===
          previousMonthYm
      );

    const lifetimeDaily =
      dailyStats.filter(
        (day) =>
          day.date.slice(0, 7) <=
          targetYm
      );

    const beforeTargetMonthDaily =
      dailyStats.filter(
        (day) =>
          day.date.slice(0, 7) <
          targetYm
      );

    const monthly =
      summarizeDailyStats(
        monthlyDaily
      );

    const previousMonthSummary =
      summarizeDailyStats(
        previousMonthDaily
      );

    const lifetime =
      summarizeDailyStats(
        lifetimeDaily
      );

    const beforeTargetMonth =
      summarizeDailyStats(
        beforeTargetMonthDaily
      );

    const achieved =
      MILESTONE_STEPS.filter(
        (goal) =>
          lifetime.steps >=
          goal
      );

    const newlyAchieved =
      MILESTONE_STEPS.filter(
        (goal) =>
          beforeTargetMonth.steps <
            goal &&
          lifetime.steps >=
            goal
      );

    const nextGoal =
      MILESTONE_STEPS.find(
        (goal) =>
          lifetime.steps <
          goal
      ) || null;

    return {
      participantId:
        normalizedParticipantId,

      targetYm,

      monthly,

      previousMonth: {
        steps:
          previousMonthSummary
            .steps,

        difference:
          monthly.steps -
          previousMonthSummary
            .steps,

        hasActivity:
          previousMonthSummary
            .participationDays >
          0
      },

      lifetime,

      milestones: {
        achieved,
        newlyAchieved,
        nextGoal
      },

      daily:
        monthlyDaily.map(
          (day) => ({
            date:
              day.date,

            steps:
              day.steps
          })
        )
    };
  }

  const api = Object.freeze({
    milestoneSteps:
      MILESTONE_STEPS,

    normalizeNonNegativeNumber,

    caloriesFromSteps,

    isValidIsoDate,

    previousYm,

    getParticipantEntrySummary,

    buildParticipantDailyStats,

    buildMonthlyReportStats
  });

  root.SeedStudioMonthlyReport =
    api;

})(
  typeof window !== "undefined"
    ? window
    : globalThis
);
