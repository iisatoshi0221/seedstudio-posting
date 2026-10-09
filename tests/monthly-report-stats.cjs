"use strict";

const assert = require("node:assert/strict");

require("../monthly-report.js");

const {
  previousYm,
  buildMonthlyReportStats
} = globalThis.SeedStudioMonthlyReport;

const U = "U_TEST";

function record(
  postingDate,
  quantity,
  participants
) {
  return {
    postingDate,
    quantity,
    participants
  };
}

function p(
  steps,
  participantId = U
) {
  return {
    participantId,
    steps
  };
}

function pickCore(result) {
  return {
    monthly:
      result.monthly,

    previousMonth:
      result.previousMonth,

    lifetime:
      result.lifetime,

    milestones:
      result.milestones,

    daily:
      result.daily
  };
}

// ------------------------------------------------------------
// Case A - normal aggregation
// ------------------------------------------------------------

const caseA = [
  record("2026-09-10", 200, [p(6000)]),
  record("2026-09-20", 250, [p(7000)]),
  record("2026-10-07", 300, [p(4820)]),
  record("2026-10-08", 400, [p(5130)]),
  record("2026-10-11", 540, [p(7860)])
];

assert.deepStrictEqual(
  pickCore(
    buildMonthlyReportStats(
      caseA,
      U,
      "2026-10"
    )
  ),
  {
    monthly: {
      steps: 17810,
      participationDays: 3,
      averageDailySteps: 5937,
      bestDailySteps: 7860,
      calories: 891,
      relatedQuantity: 1240
    },
    previousMonth: {
      steps: 13000,
      difference: 4810,
      hasActivity: true
    },
    lifetime: {
      steps: 30810,
      participationDays: 5,
      averageDailySteps: 6162,
      bestDailySteps: 7860,
      calories: 1541,
      relatedQuantity: 1690
    },
    milestones: {
      achieved: [10000],
      newlyAchieved: [],
      nextGoal: 50000
    },
    daily: [
      { date: "2026-10-07", steps: 4820 },
      { date: "2026-10-08", steps: 5130 },
      { date: "2026-10-11", steps: 7860 }
    ]
  }
);

// ------------------------------------------------------------
// Case B - multiple records on one day
// ------------------------------------------------------------

const caseB = [
  record("2026-10-07", 300, [p(2000)]),
  record("2026-10-07", 400, [p(3200)]),
  record("2026-10-08", 250, [p(4500)])
];

assert.deepStrictEqual(
  pickCore(
    buildMonthlyReportStats(
      caseB,
      U,
      "2026-10"
    )
  ),
  {
    monthly: {
      steps: 9700,
      participationDays: 2,
      averageDailySteps: 4850,
      bestDailySteps: 5200,
      calories: 485,
      relatedQuantity: 950
    },
    previousMonth: {
      steps: 0,
      difference: 9700,
      hasActivity: false
    },
    lifetime: {
      steps: 9700,
      participationDays: 2,
      averageDailySteps: 4850,
      bestDailySteps: 5200,
      calories: 485,
      relatedQuantity: 950
    },
    milestones: {
      achieved: [],
      newlyAchieved: [],
      nextGoal: 10000
    },
    daily: [
      { date: "2026-10-07", steps: 5200 },
      { date: "2026-10-08", steps: 4500 }
    ]
  }
);

// ------------------------------------------------------------
// Case C - no previous-month activity
// ------------------------------------------------------------

const caseC =
  buildMonthlyReportStats(
    [
      record(
        "2026-10-15",
        500,
        [p(12000)]
      )
    ],
    U,
    "2026-10"
  );

assert.deepStrictEqual(
  caseC.previousMonth,
  {
    steps: 0,
    difference: 12000,
    hasActivity: false
  }
);

assert.deepStrictEqual(
  caseC.milestones,
  {
    achieved: [10000],
    newlyAchieved: [10000],
    nextGoal: 50000
  }
);

// ------------------------------------------------------------
// Case D - year boundary
// ------------------------------------------------------------

assert.equal(
  previousYm("2027-01"),
  "2026-12"
);

const caseD =
  buildMonthlyReportStats(
    [
      record(
        "2026-12-20",
        400,
        [p(10000)]
      ),
      record(
        "2027-01-10",
        500,
        [p(20000)]
      )
    ],
    U,
    "2027-01"
  );

assert.equal(
  caseD.monthly.steps,
  20000
);
assert.equal(
  caseD.previousMonth.steps,
  10000
);
assert.equal(
  caseD.previousMonth.difference,
  10000
);
assert.equal(
  caseD.previousMonth.hasActivity,
  true
);
assert.equal(
  caseD.lifetime.steps,
  30000
);
assert.equal(
  caseD.lifetime.relatedQuantity,
  900
);
assert.deepStrictEqual(
  caseD.milestones,
  {
    achieved: [10000],
    newlyAchieved: [],
    nextGoal: 50000
  }
);

// ------------------------------------------------------------
// Case E - historical reprint excludes future data
// ------------------------------------------------------------

const caseE = [
  ...caseA,
  record(
    "2026-11-05",
    1000,
    [p(50000)]
  )
];

assert.deepStrictEqual(
  pickCore(
    buildMonthlyReportStats(
      caseE,
      U,
      "2026-10"
    )
  ),
  pickCore(
    buildMonthlyReportStats(
      caseA,
      U,
      "2026-10"
    )
  )
);

// ------------------------------------------------------------
// Case F - one newly reached milestone
// ------------------------------------------------------------

const caseF =
  buildMonthlyReportStats(
    [
      record(
        "2026-09-20",
        1000,
        [p(42000)]
      ),
      record(
        "2026-10-05",
        400,
        [p(15000)]
      ),
      record(
        "2026-10-12",
        400,
        [p(15000)]
      ),
      record(
        "2026-10-19",
        400,
        [p(15630)]
      )
    ],
    U,
    "2026-10"
  );

assert.deepStrictEqual(
  caseF.monthly,
  {
    steps: 45630,
    participationDays: 3,
    averageDailySteps: 15210,
    bestDailySteps: 15630,
    calories: 2282,
    relatedQuantity: 1200
  }
);

assert.deepStrictEqual(
  caseF.lifetime,
  {
    steps: 87630,
    participationDays: 4,
    averageDailySteps: 21908,
    bestDailySteps: 42000,
    calories: 4382,
    relatedQuantity: 2200
  }
);

assert.deepStrictEqual(
  caseF.milestones,
  {
    achieved: [
      10000,
      50000
    ],
    newlyAchieved: [
      50000
    ],
    nextGoal:
      100000
  }
);

// ------------------------------------------------------------
// Case G - multiple milestones in one month
// ------------------------------------------------------------

const caseG =
  buildMonthlyReportStats(
    [
      record(
        "2026-09-30",
        100,
        [p(8000)]
      ),
      record(
        "2026-10-15",
        100,
        [p(112000)]
      )
    ],
    U,
    "2026-10"
  );

assert.deepStrictEqual(
  caseG.milestones,
  {
    achieved: [
      10000,
      50000,
      100000
    ],
    newlyAchieved: [
      10000,
      50000,
      100000
    ],
    nextGoal:
      250000
  }
);

// ------------------------------------------------------------
// Case H - invalid/negative values and duplicate participant
// ------------------------------------------------------------

const originalWarn =
  console.warn;

console.warn = () => {};

const caseH =
  buildMonthlyReportStats(
    [
      record(
        "2026-10-01",
        -50,
        [p(-100)]
      ),
      record(
        "2026-10-02",
        "",
        [p("")]
      ),
      record(
        "2026-10-03",
        "abc",
        [p("abc")]
      ),
      record(
        "2026-10-04",
        200,
        [
          p(1000),
          p(500)
        ]
      ),
      record(
        "2026-10-XX",
        999,
        [p(9999)]
      )
    ],
    U,
    "2026-10"
  );

console.warn =
  originalWarn;

assert.deepStrictEqual(
  caseH.monthly,
  {
    steps: 1500,
    participationDays: 4,
    averageDailySteps: 375,
    bestDailySteps: 1500,
    calories: 75,
    relatedQuantity: 200
  }
);

// ------------------------------------------------------------
// Case I - unrelated participant must not affect U_TEST
// ------------------------------------------------------------

const caseI = [
  ...caseA,
  record(
    "2026-10-10",
    5000,
    [
      p(
        50000,
        "U_OTHER"
      )
    ]
  )
];

assert.deepStrictEqual(
  pickCore(
    buildMonthlyReportStats(
      caseI,
      U,
      "2026-10"
    )
  ),
  pickCore(
    buildMonthlyReportStats(
      caseA,
      U,
      "2026-10"
    )
  )
);

console.log(
  "MR-1A A-I: all tests passed."
);
