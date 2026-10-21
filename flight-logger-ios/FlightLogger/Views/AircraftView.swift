import SceneKit
import SwiftUI
import UIKit

/// A small aircraft in 3D, built from primitives so the app ships no model file.
///
/// It is for the apron: the aircraft turns to the GPS track, the propeller turns
/// while it moves, and the wheels roll at the ground speed. It shows where the
/// aircraft is pointing; it is not an attitude instrument and does not show pitch
/// or bank.
struct AircraftView: UIViewRepresentable {

    /// Degrees true. Nil keeps the last heading.
    var track: Double?
    /// Metres per second.
    var groundSpeed: Double

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> SCNView {
        let view = SCNView()
        view.backgroundColor = .clear
        view.antialiasingMode = .multisampling4X
        view.autoenablesDefaultLighting = true
        view.allowsCameraControl = false
        view.scene = context.coordinator.scene
        view.isPlaying = true
        return view
    }

    func updateUIView(_ view: SCNView, context: Context) {
        context.coordinator.apply(track: track, groundSpeed: groundSpeed)
    }

    final class Coordinator {

        let scene = SCNScene()
        private let root = SCNNode()
        private let propeller = SCNNode()
        private var wheels: [SCNNode] = []
        private var spinningSpeed: Double = 0

        init() {
            scene.rootNode.addChildNode(root)
            buildAircraft()
            buildApron()
            buildCamera()
        }

        /// Turns the nose to `track` (degrees true, clockwise from north) and
        /// starts or stops the turning parts for the ground speed.
        func apply(track: Double?, groundSpeed: Double) {
            if let track {
                SCNTransaction.begin()
                SCNTransaction.animationDuration = 0.3
                // SceneKit turns counter-clockwise seen from above, so negate.
                root.eulerAngles.y = CGFloat(-track * .pi / 180)
                SCNTransaction.commit()
            }
            setMotion(groundSpeed)
        }

        private func setMotion(_ speed: Double) {
            let moving = speed > 0.5
            // Rebuild the animations only when the speed has changed noticeably;
            // restarting every update would stutter the spin.
            let changed = abs(speed - spinningSpeed) > max(0.5, spinningSpeed * 0.25)
            guard moving != (spinningSpeed > 0.5) || (moving && changed) else { return }
            spinningSpeed = moving ? speed : 0

            propeller.removeAllActions()
            wheels.forEach { $0.removeAllActions() }
            guard moving else { return }

            // Propeller: a fixed spin while taxiing, faster the more ground speed.
            let turnsPerSecond = min(12, 2 + speed * 0.6)
            propeller.runAction(.repeatForever(.rotateBy(x: 0, y: 0, z: 2 * .pi, duration: 1 / turnsPerSecond)))

            // Wheels roll without slipping: one turn per circumference.
            let wheelRadius = 0.22
            let circumference = 2 * Double.pi * wheelRadius
            let duration = max(0.05, circumference / speed)
            for wheel in wheels {
                wheel.runAction(.repeatForever(.rotateBy(x: 2 * .pi, y: 0, z: 0, duration: duration)))
            }
        }

        // MARK: - Parts

        private func buildAircraft() {
            let white = material(.white)
            let orange = material(UIColor(red: 0.85, green: 0.36, blue: 0.05, alpha: 1))
            let dark = material(UIColor(white: 0.18, alpha: 1))

            // Fuselage: a capsule lying along the z axis, nose at -z.
            let body = SCNCapsule(capRadius: 0.36, height: 3.4)
            body.firstMaterial = white
            let fuselage = SCNNode(geometry: body)
            fuselage.eulerAngles.x = .pi / 2
            fuselage.position = SCNVector3(0, 0.5, 0)
            root.addChildNode(fuselage)

            // Wings, high-wing style, in the company colour.
            let wing = SCNBox(width: 5.4, height: 0.08, length: 0.95, chamferRadius: 0.02)
            wing.firstMaterial = orange
            let wingNode = SCNNode(geometry: wing)
            wingNode.position = SCNVector3(0, 0.86, -0.2)
            root.addChildNode(wingNode)

            // Tailplane and fin.
            let stab = SCNBox(width: 1.9, height: 0.07, length: 0.5, chamferRadius: 0.01)
            stab.firstMaterial = white
            let stabNode = SCNNode(geometry: stab)
            stabNode.position = SCNVector3(0, 0.62, 1.55)
            root.addChildNode(stabNode)

            let fin = SCNBox(width: 0.08, height: 0.95, length: 0.7, chamferRadius: 0.01)
            fin.firstMaterial = orange
            let finNode = SCNNode(geometry: fin)
            finNode.position = SCNVector3(0, 1.05, 1.5)
            root.addChildNode(finNode)

            // Propeller on a pivot at the nose, spinning about the z axis.
            let blade = SCNBox(width: 1.9, height: 0.12, length: 0.04, chamferRadius: 0.01)
            blade.firstMaterial = dark
            let bladeNode = SCNNode(geometry: blade)
            propeller.addChildNode(bladeNode)
            propeller.position = SCNVector3(0, 0.5, -1.82)
            propeller.eulerAngles.z = 0
            root.addChildNode(propeller)

            // Main gear and nose wheel.
            for x in [CGFloat(-0.95), CGFloat(0.95)] {
                wheels.append(addWheel(at: SCNVector3(x, 0.22, 0.15), material: dark))
            }
            wheels.append(addWheel(at: SCNVector3(0, 0.22, -1.35), material: dark))
        }

        private func addWheel(at position: SCNVector3, material: SCNMaterial) -> SCNNode {
            let tyre = SCNCylinder(radius: 0.22, height: 0.14)
            tyre.firstMaterial = material
            let node = SCNNode(geometry: tyre)
            // A cylinder stands along y; lay it on its side to roll along z.
            node.eulerAngles.z = .pi / 2
            node.position = position
            root.addChildNode(node)
            return node
        }

        /// A faint disc under the aircraft, so it reads as standing on something.
        private func buildApron() {
            let disc = SCNCylinder(radius: 4.5, height: 0.02)
            disc.firstMaterial = material(UIColor.systemGray.withAlphaComponent(0.25))
            let node = SCNNode(geometry: disc)
            node.position = SCNVector3(0, -0.02, 0)
            scene.rootNode.addChildNode(node)
        }

        private func buildCamera() {
            let camera = SCNCamera()
            camera.fieldOfView = 34
            let node = SCNNode()
            node.camera = camera
            node.position = SCNVector3(0, 7.5, 9.5)
            node.constraints = [SCNLookAtConstraint(target: root)]
            scene.rootNode.addChildNode(node)
        }

        private func material(_ colour: UIColor) -> SCNMaterial {
            let m = SCNMaterial()
            m.diffuse.contents = colour
            m.lightingModel = .blinn
            return m
        }
    }
}
