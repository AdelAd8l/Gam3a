from app.planner import CourseNeed, Slot, find_conflicts, plan_week, subtract, to_minutes

WINDOW = (to_minutes("09:00"), to_minutes("21:00"))


def test_subtract():
    assert subtract([(0, 100)], (20, 30)) == [(0, 20), (30, 100)]
    assert subtract([(0, 100)], (0, 100)) == []
    assert subtract([(0, 10), (50, 60)], (5, 55)) == [(0, 5), (55, 60)]


def test_sessions_cover_credit_hours():
    r = plan_week([CourseNeed(1, 3), CourseNeed(2, 2)], [], WINDOW, set(), 2, 60)
    per_course = {1: 0, 2: 0}
    for s in r.sessions:
        per_course[s.course_id] += s.end - s.start
    assert per_course == {1: 6 * 60, 2: 4 * 60}
    assert not r.unplaced_minutes


def test_sessions_avoid_classes_rest_days_and_each_other():
    classes = [Slot(0, to_minutes("09:00"), to_minutes("12:00")), Slot(1, to_minutes("13:00"), to_minutes("15:00"))]
    r = plan_week([CourseNeed(1, 3), CourseNeed(2, 3)], classes, WINDOW, {4}, 2, 90)
    for s in r.sessions:
        assert s.weekday != 4
        assert WINDOW[0] <= s.start and s.end <= WINDOW[1]
        for c in classes:
            # never overlapping a class, and at least a 15-minute buffer after it
            assert not (s.weekday == c.weekday and s.start < c.end + 15 and c.start < s.end)
    by_day = {}
    for s in r.sessions:
        by_day.setdefault(s.weekday, []).append(s)
    for day in by_day.values():
        day.sort(key=lambda s: s.start)
        for a, b in zip(day, day[1:], strict=False):
            assert b.start >= a.end + 15


def test_spreads_a_course_across_days():
    r = plan_week([CourseNeed(1, 3)], [], WINDOW, set(), 2, 90)
    days = [s.weekday for s in r.sessions]
    assert len(days) == len(set(days)) == 4


def test_reports_what_does_not_fit():
    tiny = (to_minutes("09:00"), to_minutes("10:00"))
    r = plan_week([CourseNeed(1, 3)], [], tiny, {0, 1, 2, 3, 4, 5}, 2, 60)
    assert len(r.sessions) == 1
    assert r.unplaced_minutes == {1: 5 * 60}


def test_respects_week_order():
    r = plan_week([CourseNeed(1, 1)], [], WINDOW, set(), 1, 60, week_order=[5, 6, 0, 1, 2, 3, 4])
    assert r.sessions[0].weekday == 5  # Saturday first


def test_conflicts():
    a = ("class", 1, Slot(0, 600, 690))
    b = ("class", 2, Slot(0, 660, 720))
    c = ("busy", 3, Slot(0, 690, 750))
    assert find_conflicts([a, b, c]) == [("class", 1, "class", 2), ("class", 2, "busy", 3)]


def test_last_session_takes_the_remainder():
    r = plan_week([CourseNeed(1, 2)], [], WINDOW, set(), 2, 90)  # 240 min → 90 + 90 + 60
    assert sorted(s.end - s.start for s in r.sessions) == [60, 90, 90]
