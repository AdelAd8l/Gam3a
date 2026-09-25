import pytest

from app.grading import GradedCourse, required_gpa, term_result


def test_term_gpa_weights_by_credits():
    r = term_result([GradedCourse(3, "A"), GradedCourse(3, "B"), GradedCourse(2, "C+")], "4")
    # (12 + 9 + 4.6) / 8
    assert r.gpa == pytest.approx(3.2, abs=0.001)
    assert r.gpa_credits == 8 and r.earned_credits == 8


def test_pass_withdrawn_and_in_progress_are_excluded():
    r = term_result(
        [GradedCourse(3, "A"), GradedCourse(2, "P", in_gpa=False), GradedCourse(3, "W"), GradedCourse(3, None)], "4"
    )
    assert r.gpa == 4.0
    assert r.gpa_credits == 3
    assert r.earned_credits == 5  # A + pass


def test_failing_counts_in_gpa_but_earns_nothing():
    r = term_result([GradedCourse(3, "A"), GradedCourse(3, "F")], "4")
    assert r.gpa == 2.0 and r.earned_credits == 3


def test_five_point_scale():
    assert term_result([GradedCourse(3, "A+"), GradedCourse(3, "B")], "5").gpa == 4.5


def test_no_graded_courses_means_no_gpa():
    assert term_result([GradedCourse(3, None)], "4").gpa is None


def test_required_gpa():
    # 30 credits at 3.0 → need x over 15 credits to reach 3.2: (3.2*45 - 90) / 15 = 3.6
    assert required_gpa(90, 30, 3.2, 15) == 3.6
    assert required_gpa(90, 30, 3.2, 0) is None
