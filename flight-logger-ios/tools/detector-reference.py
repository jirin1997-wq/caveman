"""Reference transcription of FlightDetector — NOT the source of truth.

`FlightLogger/Core/FlightDetector.swift` is the implementation. This file is a
line-by-line Python copy of the same state machine, kept for one reason: no
Swift toolchain runs on Linux CI (or in the environment this app was written
in), and a test suite whose expectations are wrong is worse than no test suite.
Running this replays the same synthetic tracks as `FlightDetectorTests` and
prints what the algorithm actually does, so the XCTest assertions can be checked
without a Mac.

    python3 tools/detector-reference.py

If you change the detector, change it in Swift first. If this file disagrees
with the Swift, this file is the one that is wrong.
"""
import math

R = 6371008.8
KT = 0.514444
FT = 0.3048


def distance(a, b):
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp = math.radians(b[0] - a[0])
    dl = math.radians(b[1] - a[1])
    h = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*R*math.asin(min(1, math.sqrt(h)))


def offset(c, north, east):
    dlat = north / R * 180 / math.pi
    dlon = east / (R * math.cos(math.radians(c[0]))) * 180 / math.pi
    return (c[0] + dlat, c[1] + dlon)


def slope(xs, ys):
    n = len(xs)
    if n < 2:
        return None
    mx = sum(xs)/n
    my = sum(ys)/n
    num = sum((x-mx)*(y-my) for x, y in zip(xs, ys))
    den = sum((x-mx)**2 for x in xs)
    if den <= 1e-9:
        return None
    return num/den


def median(vs):
    if not vs:
        return None
    s = sorted(vs)
    m = len(s)//2
    return s[m] if len(s) % 2 else (s[m-1]+s[m])/2


class Profile:
    def __init__(self, name, to_kt, ld_kt, air_agl, gnd_agl, climb, confirm,
                 max_hacc=50, tng=60, climb_window=6, ref_radius=15000):
        self.name = name
        self.takeoffSpeed = to_kt*KT
        self.landingSpeed = ld_kt*KT
        self.airborneAGL = air_agl
        self.groundAGL = gnd_agl
        self.climbRate = climb
        self.confirmDuration = confirm
        self.maxHorizontalAccuracy = max_hacc
        self.touchAndGoWindow = tng
        self.climbWindow = climb_window
        self.referenceValidRadius = ref_radius


GLIDER = Profile("Kluzák", 25, 18, 25, 12, 0.5, 5)
ULTRALIGHT = Profile("Ultralight", 30, 22, 30, 15, 0.5, 5)
PISTON = Profile("Motorové (píst)", 45, 32, 40, 18, 0.6, 5)
TURBINE = Profile("Turbína", 70, 50, 60, 25, 1.0, 6, 60, 90, 8, 25000)


class Fix:
    __slots__ = ("t", "lat", "lon", "alt", "speed", "course", "hacc", "vacc")

    def __init__(self, t, lat, lon, alt, speed=-1, course=-1, hacc=5, vacc=8):
        self.t, self.lat, self.lon, self.alt = t, lat, lon, alt
        self.speed, self.course, self.hacc, self.vacc = speed, course, hacc, vacc

    @property
    def coord(self):
        return (self.lat, self.lon)

    @property
    def usable_alt(self):
        return self.vacc >= 0


class Noise:
    def __init__(self, seed=42):
        self.state = seed

    def next(self):
        self.state = (self.state * 6364136223846793005 + 1442695040888963407) % (1 << 64)
        bits = (self.state >> 11) & 0x1FFFFFFFFFFFFF
        return bits / float(0x20000000000000) * 2 - 1


class Seg:
    def __init__(self, duration, speed=None, climb=0, speedFrom=None, speedTo=None,
                 climbFrom=None, climbTo=None, heading=90):
        self.duration = duration
        self.sf = speed if speedFrom is None else speedFrom
        self.st = speed if speedTo is None else speedTo
        self.cf = climb if climbFrom is None else climbFrom
        self.ct = climb if climbTo is None else climbTo
        self.heading = heading


def make(origin, start_alt, start, segments, hnoise=3, vnoise=4, seed=42, report_speed=True):
    fixes = []
    pos = origin
    alt = start_alt
    t = start
    noise = Noise(seed)
    for seg in segments:
        steps = max(1, int(round(seg.duration)))
        for step in range(steps):
            frac = 0.0 if steps <= 1 else step/(steps-1)
            spd = seg.sf + (seg.st - seg.sf)*frac
            climb = seg.cf + (seg.ct - seg.cf)*frac
            rad = math.radians(seg.heading)
            pos = offset(pos, spd*math.cos(rad), spd*math.sin(rad))
            alt += climb
            fixes.append(Fix(
                t,
                pos[0] + noise.next()*hnoise/111000,
                pos[1] + noise.next()*hnoise/111000,
                alt + noise.next()*vnoise,
                max(0, spd + noise.next()*0.5) if report_speed else -1,
                seg.heading, 5, 8))
            t += 1
    return fixes


def standard_flight(origin=(49.9, 15.0), elev=250, start=1_700_000_000):
    return make(origin, elev, start, [
        Seg(90, speed=8*KT),
        Seg(15, speedFrom=8*KT, speedTo=65*KT),
        Seg(20, speedFrom=65*KT, speedTo=75*KT, climbFrom=1, climbTo=4),
        Seg(150, speed=80*KT, climb=4),
        Seg(240, speed=100*KT),
        Seg(200, speed=85*KT, climb=-3),
        Seg(30, speedFrom=70*KT, speedTo=55*KT, climbFrom=-3, climbTo=0),
        Seg(25, speedFrom=55*KT, speedTo=8*KT),
        Seg(90, speed=8*KT),
    ])


def touch_and_go(origin=(49.9, 15.0), elev=250, start=1_700_000_000):
    return make(origin, elev, start, [
        Seg(60, speed=8*KT),
        Seg(15, speedFrom=8*KT, speedTo=65*KT),
        Seg(20, speedFrom=65*KT, speedTo=75*KT, climbFrom=1, climbTo=4),
        Seg(90, speed=80*KT, climb=3),
        Seg(120, speed=90*KT),
        Seg(100, speed=80*KT, climb=-3),
        Seg(25, speedFrom=70*KT, speedTo=55*KT, climbFrom=-1.2, climbTo=0),
        Seg(15, speed=40*KT),
        Seg(15, speedFrom=40*KT, speedTo=70*KT, climbFrom=0, climbTo=3),
        Seg(90, speed=80*KT, climb=3),
        Seg(120, speed=90*KT),
        Seg(90, speed=80*KT, climb=-3),
        Seg(25, speedFrom=70*KT, speedTo=55*KT, climbFrom=-1.8, climbTo=0),
        Seg(25, speedFrom=55*KT, speedTo=8*KT),
        Seg(60, speed=8*KT),
    ])


def fast_taxi(origin=(49.9, 15.0), elev=250, start=1_700_000_000):
    return make(origin, elev, start, [
        Seg(60, speed=10*KT),
        Seg(20, speedFrom=10*KT, speedTo=60*KT),
        Seg(30, speed=60*KT),
        Seg(25, speedFrom=60*KT, speedTo=10*KT),
        Seg(60, speed=10*KT),
    ])


class Sample:
    __slots__ = ("fix", "speed", "agl", "elev_source", "climb")

    def __init__(self, fix, speed, agl, elev_source, climb):
        self.fix, self.speed, self.agl = fix, speed, agl
        self.elev_source, self.climb = elev_source, climb


class Detector:
    BUFFER_SPAN = 120
    GAP = 60

    def __init__(self, profile):
        self.p = profile
        self.phase = "unknown"
        self.buffer = []
        self.last_fix = None
        self.air_since = None
        self.gnd_since = None
        self.touch_since = None
        self.seen_ground = False
        self.seen_air = False

    def ingest(self, fix, elevation):
        if not (fix.hacc >= 0 and fix.hacc <= self.p.maxHorizontalAccuracy):
            return []
        if self.last_fix is not None:
            dt = fix.t - self.last_fix.t
            if dt <= 0:
                return []
            if dt > self.GAP:
                self.buffer = []
                self.air_since = None
                self.gnd_since = None
                self.touch_since = None
                self.phase = "unknown"
                self.seen_ground = False
                self.seen_air = False
        speed = self.resolve_speed(fix)
        self.last_fix = fix
        agl = None
        if elevation is not None and fix.usable_alt:
            agl = fix.alt - elevation[0]
        s = Sample(fix, speed, agl, elevation[1] if elevation else None, None)
        self.buffer.append(s)
        while self.buffer and fix.t - self.buffer[0].fix.t > self.BUFFER_SPAN:
            self.buffer.pop(0)
        s.climb = self.climb_rate(fix.t)

        if self.was_on_ground(s) and s.speed <= self.p.landingSpeed:
            self.seen_ground = True
        if self.looks_airborne(s):
            self.seen_air = True
        return self.advance(s)

    def advance(self, s):
        if self.looks_airborne(s):
            if self.air_since is None:
                self.air_since = s.fix.t
        else:
            self.air_since = None
        if self.looks_grounded(s):
            if self.gnd_since is None:
                self.gnd_since = s.fix.t
        else:
            self.gnd_since = None
        if self.looks_touched_down(s):
            if self.touch_since is None:
                self.touch_since = s.fix.t
        else:
            self.touch_since = None

        def confirmed(since):
            return since is not None and s.fix.t - since >= self.p.confirmDuration

        if self.phase == "unknown":
            if confirmed(self.air_since):
                self.phase = "airborne"
                self.air_since = None
                if not self.seen_ground:
                    return []
                return [self.event("takeoff", self.takeoff_index())]
            if confirmed(self.gnd_since):
                self.phase = "onGround"
                self.gnd_since = None
                if not self.seen_air:
                    return []
                return [self.event("landing", self.landing_index())]
            return []
        if self.phase == "onGround":
            if not confirmed(self.air_since):
                return []
            self.phase = "airborne"
            self.air_since = None
            return [self.event("takeoff", self.takeoff_index())]
        if confirmed(self.gnd_since):
            self.phase = "onGround"
            self.gnd_since = None
            self.touch_since = None
            return [self.event("landing", self.landing_index())]
        if self.touch_since is not None and s.fix.t - self.touch_since >= 3:
            self.phase = "onGround"
            self.gnd_since = None
            self.touch_since = None
            return [self.event("landing", self.landing_index())]
        return []

    def looks_airborne(self, s):
        if s.speed < self.p.takeoffSpeed:
            return False
        climbing = (s.climb or 0) >= self.p.climbRate
        if s.agl is not None:
            return s.agl >= self.p.airborneAGL or (s.agl >= self.p.groundAGL and climbing)
        return climbing

    def looks_grounded(self, s):
        slow = s.speed <= self.p.landingSpeed
        if s.agl is not None:
            return s.agl <= self.p.groundAGL and slow
        level = abs(s.climb or 0) <= self.p.climbRate
        return slow and level

    def looks_touched_down(self, s):
        if s.agl is None:
            return False
        return s.agl <= self.p.groundAGL * 0.5 and abs(s.climb or 0) <= self.p.climbRate

    def was_on_ground(self, s):
        if s.agl is not None:
            return s.agl <= self.p.groundAGL
        return s.speed <= self.p.landingSpeed

    def takeoff_index(self):
        i = len(self.buffer) - 1
        while i > 0 and not self.was_on_ground(self.buffer[i-1]):
            i -= 1
        return i

    def landing_index(self):
        i = len(self.buffer) - 1
        while i > 0 and self.was_on_ground(self.buffer[i-1]):
            i -= 1
        return i

    def event(self, kind, index, cap=None):
        s = self.buffer[max(0, min(index, len(self.buffer)-1))]
        if s.agl is None:
            conf = "low"
        else:
            rank = {"groundReference": 4, "airport": 3, "online": 2, "cache": 1}.get(s.elev_source, 0)
            conf = "high" if rank >= 3 else "medium"
        if cap == "medium" and conf == "high":
            conf = "medium"
        return dict(kind=kind, t=s.fix.t, agl=s.agl, speed=s.speed, confidence=conf)

    def resolve_speed(self, fix):
        if fix.speed >= 0:
            return fix.speed
        last = self.last_fix
        if last is None:
            return 0
        dt = fix.t - last.t
        if dt <= 0:
            return 0
        return distance(last.coord, fix.coord) / dt

    def climb_rate(self, now):
        w = [s for s in self.buffer if now - s.fix.t <= self.p.climbWindow and s.fix.usable_alt]
        if len(w) < 3:
            return None
        span = w[-1].fix.t - w[0].fix.t
        if span < self.p.climbWindow * 0.5:
            return None
        return slope([s.fix.t for s in w], [s.fix.alt for s in w])



def run(fixes, profile=PISTON, elevation=250, source="groundReference"):
    d = Detector(profile)
    out = []
    for f in fixes:
        e = (elevation, source) if elevation is not None else None
        out.extend(d.ingest(f, e))
    return out


def _main():
    """Replays every scenario the XCTest suite asserts on."""
    import copy

    base = 1_700_000_000

    def show(label, events):
        rendered = [
            (e["kind"], round(e["t"] - base, 1), e["confidence"])
            for e in events
        ]
        print(f"{label:<22} {rendered}")

    show("standard flight", run(standard_flight()))
    show("field at 2000 m", run(standard_flight(elev=2000), elevation=2000))
    show("no terrain data", run(standard_flight(), elevation=None))
    show("touch and go", run(touch_and_go()))
    show("fast taxi", run(fast_taxi()))

    all_fixes = standard_flight()
    show("start at cruise", run(all_fixes[300:]))

    noisy = [copy.copy(f) for f in all_fixes]
    for i in range(0, len(noisy), 7):
        noisy[i].hacc = 400
    show("bad accuracy", run(noisy))

    head = [copy.copy(f) for f in all_fixes[:60]]
    tail = []
    for f in all_fixes[400:]:
        g = copy.copy(f)
        g.t = f.t + 600
        tail.append(g)
    show("10 min signal gap", run(head + tail))

    derived = make((49.9, 15.0), 250, base, [
        Seg(60, speed=5 * KT),
        Seg(15, speedFrom=5 * KT, speedTo=65 * KT),
        Seg(20, speedFrom=65 * KT, speedTo=75 * KT, climbFrom=1, climbTo=4),
        Seg(120, speed=85 * KT, climb=4),
        Seg(175, speed=85 * KT, climb=-3),
        Seg(20, speedFrom=70 * KT, speedTo=50 * KT, climbFrom=-0.5, climbTo=0),
        Seg(25, speedFrom=50 * KT, speedTo=5 * KT),
        Seg(60, speed=5 * KT),
    ], hnoise=1, vnoise=2, report_speed=False)
    show("no speed reported", run(derived))

    glider = make((49.9, 15.0), 250, base, [
        Seg(60, speed=3 * KT),
        Seg(12, speedFrom=3 * KT, speedTo=35 * KT),
        Seg(40, speed=38 * KT, climb=3),
        Seg(180, speed=42 * KT, climb=1),
        Seg(145, speed=40 * KT, climb=-2),
        Seg(20, speedFrom=35 * KT, speedTo=20 * KT, climbFrom=-1, climbTo=0),
        Seg(20, speedFrom=20 * KT, speedTo=2 * KT),
        Seg(60, speed=2 * KT),
    ])
    show("glider / glider", run(glider, profile=GLIDER))
    show("glider / piston", run(glider, profile=PISTON))


if __name__ == "__main__":
    _main()
