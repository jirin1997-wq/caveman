#!/usr/bin/env python3
"""A stand-in for the one check this project cannot run: the compiler.

There is no Swift toolchain where this app was written, so every call site was
at risk of drifting from its declaration without anything noticing. This walks
both and compares them.

It does not type-check. What it does catch is the class of mistake a scripted
edit makes: a renamed argument label, a call that lost a required parameter, a
type that no longer exists, an unbalanced brace. It found a real one — an
initializer reading its own property before the object was whole.

    python3 tools/check-swift-calls.py

Exits non-zero if anything looks wrong. Known false positives are listed in
IGNORED below, each with the reason.
"""
import glob
import re
import sys

# Call sites the checker cannot read correctly, with why.
IGNORED: set[str] = set()

KNOWN_TYPES = set('''
Int Double Float Bool String Date UUID URL Data Error Void Any AnyObject Never
Array Dictionary Set Optional Result Task TimeInterval IndexSet Calendar Locale
JSONEncoder JSONDecoder FileManager FileHandle UserDefaults Bundle NSError
DateFormatter ISO8601DateFormatter NumberFormatter Notification EdgeInsets
URLSession URLRequest URLComponents URLQueryItem HTTPURLResponse URLResponse
URLSessionDataTask OperationQueue DispatchQueue
Codable Decodable Encodable Equatable Hashable Identifiable Sendable Comparable
CaseIterable ObservableObject RawRepresentable CustomStringConvertible
LocalizedError MainActor Published State StateObject ObservedObject
EnvironmentObject Environment Binding View Text Image Button Label Toggle
Picker Slider Stepper TextField Form List Section VStack HStack ZStack
LazyVGrid GridItem ScrollView Spacer Divider NavigationStack NavigationLink
NavigationView TabView Group ForEach Color Font ProgressView Capsule
RoundedRectangle Circle Rectangle ContentUnavailableView TimelineView ShareLink
App Scene WindowGroup EmptyView AnyView ViewBuilder ToolbarItem ToolbarItemGroup
LabeledContent Canvas GraphicsContext Path StrokeStyle CGPoint CGRect CGSize
GeometryReader DragGesture Gesture
CGFloat UIColor UIImage UIApplication UIActivityViewController UIViewController
UIViewControllerRepresentable UIViewRepresentable NSObject Context UTType
ClosedRange Range CLLocation CLLocationManager CLLocationCoordinate2D
CLLocationManagerDelegate CLAuthorizationStatus CLLocationDistance
CLLocationAccuracy CMAltimeter CMMotionManager Map MapPolyline Marker
Annotation MapCameraPosition MKMapView MKMapViewDelegate MKTileOverlay
MKTileOverlayPath MKTileOverlayRenderer MKOverlay MKOverlayRenderer MKPolyline
MKPolylineRenderer MKPointAnnotation MKAnnotation MKAnnotationView
MKMarkerAnnotationView MKUserLocation MKCoordinateRegion MKCoordinateSpan
XCTestCase XCTest Self Type NSTemporaryDirectory UInt64 Int64
SceneKit SCNView SCNScene SCNNode SCNVector3 SCNBox SCNCapsule SCNCylinder
SCNCamera SCNLookAtConstraint SCNMaterial SCNTransaction SCNAction
'''.split())

SKIP_WORDS = {'if', 'for', 'while', 'switch', 'guard', 'return', 'catch', 'func', 'init'}
PARAM = re.compile(r'^(?:(\w+)\s+(\w+)|(\w+))\s*:')
CALL = re.compile(r'(?<![\w.])(\w+)\s*\(')
TYPE_DECL = re.compile(r'\b(?:struct|class|enum|extension|protocol|actor)\s+(\w+)')


def strip_noise(src):
    """Blank out comments and string bodies, keeping offsets intact."""
    out, i, n = [], 0, len(src)
    while i < n:
        if src.startswith('"""', i):
            j = src.find('"""', i + 3)
            j = n if j < 0 else j + 3
            out.append(' ' * (j - i))
            i = j
            continue
        if src[i] == '"':
            j = i + 1
            while j < n and src[j] != '"':
                if src[j] == '\\' and j + 1 < n and src[j + 1] == '(':
                    # \( ... ) interpolation: it may hold a string of its own
                    depth, j = 1, j + 2
                    while j < n and depth > 0:
                        if src[j] == '(':
                            depth += 1
                        elif src[j] == ')':
                            depth -= 1
                        elif src[j] == '"':
                            j += 1
                            while j < n and src[j] != '"':
                                if src[j] == '\\':
                                    j += 1
                                j += 1
                        j += 1
                    continue
                if src[j] == '\\':
                    j += 1
                j += 1
            out.append('"' + ' ' * (j - i - 1) + '"')
            i = j + 1
            continue
        if src.startswith('//', i):
            j = src.find('\n', i)
            j = n if j < 0 else j
            out.append(' ' * (j - i))
            i = j
            continue
        if src.startswith('/*', i):
            j = src.find('*/', i)
            j = n if j < 0 else j + 2
            out.append(' ' * (j - i))
            i = j
            continue
        out.append(src[i])
        i += 1
    return ''.join(out)


def split_top_level(text):
    parts, depth, cur = [], 0, ''
    for c in text:
        if c in '([{':
            depth += 1
        elif c in ')]}':
            depth -= 1
        if c == ',' and depth == 0:
            parts.append(cur)
            cur = ''
        else:
            cur += c
    if cur.strip():
        parts.append(cur)
    return [p.strip() for p in parts if p.strip()]


def blank_nested(body):
    """Blank what is inside nested braces, keeping the braces and newlines.

    The member regex is line-anchored and treats a `{` on the line as the mark
    of a computed property, so both have to survive — blanking them turns
    `var description: String { ... }` into something that looks stored.
    """
    out, depth = [], 0
    for c in body:
        if c == '{':
            depth += 1
            out.append(c)          # the brace itself stays: it is what marks
            continue               # a computed property as not stored
        if c == '}':
            depth = max(0, depth - 1)
            out.append(c)
            continue
        out.append(c if (c == '\n' or depth == 0) else ' ')
    return ''.join(out)


def balanced_end(src, open_index):
    depth = 0
    for i in range(open_index, len(src)):
        if src[i] in '([{':
            depth += 1
        elif src[i] in ')]}':
            depth -= 1
            if depth == 0:
                return i
    return -1


def parse_params(text):
    out = []
    for part in split_top_level(text):
        m = PARAM.match(part)
        if not m:
            continue
        label = m.group(3) or m.group(1)
        if label == '_':
            label = None
        out.append((label, '=' in part.split(':', 1)[1]))
    return out


def matches(params, labels):
    i = 0
    for index, (label, has_default) in enumerate(params):
        if i < len(labels) and labels[i] == label:
            i += 1
        elif (i < len(labels) and labels[i] is None
              and index == len(params) - 1):
            # the unlabelled trailing argument
            i += 1
        elif has_default:
            continue
        else:
            return False
    return i == len(labels)


def main():
    files = sorted(
        glob.glob('FlightLogger/**/*.swift', recursive=True)
        + glob.glob('FlightLoggerTests/*.swift')
    )
    if not files:
        print('no sources found — run this from flight-logger-ios/')
        return 1
    sources = {f: strip_noise(open(f).read()) for f in files}

    problems = []

    # 1. braces, brackets and parens must balance
    for path, src in sources.items():
        for opener, closer in (('{', '}'), ('(', ')'), ('[', ']')):
            if src.count(opener) != src.count(closer):
                problems.append(f'{path}: unbalanced {opener}{closer}')

    # 2. collect declarations
    decls, declared_types = {}, set()
    for path, src in sources.items():
        for m in TYPE_DECL.finditer(src):
            declared_types.add(m.group(1))
        for m in re.finditer(r'\bfunc\s+(\w+)\s*(?:<[^>]*>)?\s*\(', src):
            end = balanced_end(src, m.end() - 1)
            if end > 0:
                decls.setdefault(m.group(1), []).append(parse_params(src[m.end():end]))
        for m in re.finditer(r'\binit\s*\(', src):
            owner = None
            for t in TYPE_DECL.finditer(src[:m.start()]):
                owner = t
            end = balanced_end(src, m.end() - 1)
            if owner and end > 0:
                decls.setdefault(owner.group(1), []).append(parse_params(src[m.end():end]))

    # memberwise inits, for structs that declare none
    for path, src in sources.items():
        for m in re.finditer(r'\bstruct\s+(\w+)[^{]*\{', src):
            body_end = balanced_end(src, src.index('{', m.end() - 1))
            body = blank_nested(src[m.end():body_end])
            if re.search(r'\binit\s*\(', body):
                continue
            members = []
            for pm in re.finditer(
                r'^[ \t]*(?:@\w+[^\n]*?\s+)?(public\s+|private\s+|internal\s+)?(var|let)\s+'
                r'(\w+)\s*:\s*([^\n={]+?)(\s*=\s*[^\n]+)?[ \t]*$',
                body, re.MULTILINE
            ):
                if (pm.group(1) or '').strip() == 'private':
                    members = []
                    break
                optional = pm.group(4).strip().endswith('?')
                members.append((pm.group(3), bool(pm.group(5)) or optional))
            if members:
                decls.setdefault(m.group(1), []).append(members)

    # 3. every call site against its declaration
    for path, src in sources.items():
        for m in CALL.finditer(src):
            name = m.group(1)
            if name in SKIP_WORDS or name in IGNORED or name not in decls:
                continue
            if re.search(r'\b(?:func|case)\s+$', src[max(0, m.start() - 6):m.start()]):
                continue
            end = balanced_end(src, m.end() - 1)
            if end < 0:
                continue
            labels = []
            for arg in split_top_level(src[m.end():end]):
                lm = re.match(r'^(\w+)\s*:(?!:)', arg)
                labels.append(lm.group(1) if lm else None)
            # A trailing closure is an argument that lives outside the
            # parentheses: `Foo(bar: x) { ... }` passes two, not one.
            trailing = bool(re.match(r'\s*\{', src[end + 1:end + 8]))
            candidates = [labels] + ([labels + [None]] if trailing else [])
            if any(matches(p, c) for p in decls[name] for c in candidates):
                continue
            line = src[:m.start()].count('\n') + 1
            shown = ', '.join(str(x) for x in labels)
            problems.append(f'{path}:{line}: {name}({shown}) matches no declaration')

    # 4. every capitalised name used must be declared or known
    for path, src in sources.items():
        for m in re.finditer(r'(?<![\w.])([A-Z]\w+)', src):
            name = m.group(1)
            if name in declared_types or name in KNOWN_TYPES:
                continue
            if name.startswith('XCTAssert') or name.startswith('XCTFail'):
                continue
            # module names in imports
            before = src[max(0, m.start() - 12):m.start()]
            if re.search(r'import\s+$', before) or re.search(r'canImport\($', before):
                continue
            line = src[:m.start()].count('\n') + 1
            problems.append(f'{path}:{line}: {name} is not declared anywhere')

    for problem in sorted(set(problems)):
        print(problem)
    print(f'\n{len(set(problems))} problems · {len(files)} files · {len(decls)} declared names')
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main())
