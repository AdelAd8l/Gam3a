"""Create a demo student with two finished terms and a current one.

    python -m app.seed            # demo@gam3a.dev / demo-password
"""

from datetime import date, timedelta

from sqlalchemy import select

from .database import Base, SessionLocal, engine
from .models import Assessment, Busy, Course, Meeting, Term, User, delete_user
from .security import hash_password

DEMO_EMAIL = "demo@gam3a.dev"
DEMO_PASSWORD = "demo-password"

SAT, SUN, MON, TUE, WED, THU, FRI = 5, 6, 0, 1, 2, 3, 4
PAST_COLORS = ["#3E5C8A", "#4E7D5B", "#8A5A3E", "#7A4E8A", "#9A7B2F"]

PAST = [
    ("Fall 2025", [
        ("MTH101", "Calculus I", 3, "B+"), ("PHY101", "Physics I", 3, "B"),
        ("CSE101", "Intro to Programming", 3, "A"), ("ENG101", "English I", 2, "A-"),
        ("HUM111", "Critical Thinking", 2, "P"),
    ]),
    ("Spring 2026", [
        ("MTH102", "Calculus II", 3, "B"), ("PHY102", "Physics II", 3, "B+"),
        ("CSE102", "Object-Oriented Programming", 3, "A"), ("CSE111", "Discrete Mathematics", 3, "A-"),
        ("ENG102", "English II", 2, "A"),
    ]),
]

CURRENT = [
    # code, name, credits, instructor, color, meetings
    ("CSE221", "Data Structures", 3, "Dr. Salma Adel", "#3E5C8A",
     [(SUN, "10:00", "11:30", "lecture", "Hall 3"), (TUE, "12:00", "13:30", "section", "Lab 2")]),
    ("CSE231", "Digital Logic Design", 3, "Dr. Karim Nabil", "#8A5A3E",
     [(MON, "08:30", "10:00", "lecture", "Hall 1"), (WED, "14:00", "16:00", "lab", "Electronics Lab")]),
    ("MTH203", "Probability & Statistics", 3, "Dr. Hoda Samir", "#4E7D5B",
     [(SAT, "10:00", "11:30", "lecture", "Hall 5"), (MON, "12:00", "13:00", "tutorial", "Room 204")]),
    ("PHY202", "Electromagnetics", 3, "Dr. Omar Fathy", "#7A4E8A",
     [(TUE, "08:30", "10:00", "lecture", "Hall 2"), (THU, "10:00", "12:00", "lab", "Physics Lab")]),
    ("HUM201", "Technical Writing", 2, "Ms. Rana Emad", "#9A7B2F",
     [(WED, "10:00", "11:30", "lecture", "Room 110")]),
]

BUSY = [
    ("Part-time job", THU, "16:00", "20:00"),
    ("Gym", MON, "19:00", "20:30"),
    ("Gym", WED, "19:00", "20:30"),
    ("Family dinner", FRI, "18:00", "21:00"),
]


def run(only_if_missing: bool = False) -> None:
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        existing = db.scalar(select(User).where(User.email == DEMO_EMAIL))
        if existing and only_if_missing:
            return
        if existing:
            delete_user(db, existing)

        user = User(email=DEMO_EMAIL, name="Nour Hassan", university="Faculty of Engineering",
                    password_hash=hash_password(DEMO_PASSWORD), scale="4", week_start=SAT)
        db.add(user)
        db.flush()

        today = date.today()
        current_start = today - timedelta(weeks=4, days=today.weekday() - SAT if today.weekday() >= SAT else today.weekday() + 2)
        starts = [current_start - timedelta(weeks=52), current_start - timedelta(weeks=32)]

        for (name, courses), start in zip(PAST, starts, strict=True):
            term = Term(user_id=user.id, name=name, start_date=start, end_date=start + timedelta(weeks=15, days=-1))
            db.add(term)
            db.flush()
            for (code, cname, credits, grade), color in zip(courses, PAST_COLORS, strict=True):
                db.add(Course(user_id=user.id, term_id=term.id, code=code, name=cname, credits=credits,
                              grade=grade, in_gpa=grade != "P", color=color))

        term = Term(user_id=user.id, name="Fall 2026", start_date=current_start,
                    end_date=current_start + timedelta(weeks=15, days=-1), rest_days="4", hours_per_credit=1.5)
        db.add(term)
        db.flush()

        ids = {}
        for code, cname, credits, instructor, color, meetings in CURRENT:
            course = Course(user_id=user.id, term_id=term.id, code=code, name=cname, credits=credits,
                            instructor=instructor, color=color, target_grade="A+" if code == "HUM201" else None)
            db.add(course)
            db.flush()
            ids[code] = course.id
            for weekday, start, end, kind, location in meetings:
                db.add(Meeting(user_id=user.id, course_id=course.id, weekday=weekday, start=start, end=end,
                               kind=kind, location=location))
        for title, weekday, start, end in BUSY:
            db.add(Busy(user_id=user.id, term_id=term.id, title=title, weekday=weekday, start=start, end=end))

        def due(days: int) -> date:
            return today + timedelta(days=days)

        # code, title, kind, due, time, weight %, (earned, out of) or None, done
        assessments = [
            ("CSE221", "Assignment 1: Linked lists", "assignment", due(-16), "23:59", 5, (46, 50)),
            ("CSE221", "Quiz 1", "quiz", due(-9), None, 5, (8, 10)),
            ("CSE221", "Assignment 2: Stacks & queues", "assignment", due(2), "23:59", 5, (None, 50)),
            ("CSE221", "Midterm", "midterm", due(18), "10:00", 25, (None, 40)),
            ("CSE221", "Project", "project", due(60), None, 20, (None, 30)),
            ("CSE221", "Final exam", "final", due(80), "09:00", 40, (None, 60)),
            ("CSE231", "Lab report 1", "assignment", due(-5), None, 5, (22, 25)),
            ("CSE231", "Lab report 2", "assignment", due(5), None, 5, (None, 25)),
            ("CSE231", "Midterm", "midterm", due(19), "08:30", 30, (None, 30)),
            ("CSE231", "Final exam", "final", due(82), "09:00", 60, (None, 60)),
            ("MTH203", "Quiz 1", "quiz", due(-12), None, 10, (7, 10)),
            ("MTH203", "Problem set 2", "assignment", due(1), "18:00", 5, (None, 20)),
            ("MTH203", "Midterm", "midterm", due(20), "10:00", 25, (None, 50)),
            ("MTH203", "Final exam", "final", due(84), "12:00", 60, (None, 100)),
            ("PHY202", "Quiz 1", "quiz", due(4), "08:30", 10, (None, 10)),
            ("HUM201", "Reading response", "assignment", due(-3), None, 5, (19, 20)),
            ("HUM201", "Essay outline", "project", due(6), None, 10, (None, 10)),
            ("HUM201", "Final essay", "project", due(75), None, 50, (None, 100)),
        ]
        for code, title, kind, when, at, weight, (earned, out_of) in assessments:
            db.add(Assessment(user_id=user.id, course_id=ids[code], title=title, kind=kind, due_date=when,
                              due_time=at, weight=weight, points_earned=earned, points_max=out_of,
                              score=round(earned / out_of * 100, 4) if earned is not None else None,
                              done=earned is not None))
        db.commit()
    print(f"Demo user ready: {DEMO_EMAIL} / {DEMO_PASSWORD}")


if __name__ == "__main__":
    run()
