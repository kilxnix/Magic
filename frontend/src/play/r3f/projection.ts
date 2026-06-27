import { PerspectiveCamera, Vector3 } from 'three';
import type { Vec3 } from './layout';

export interface CameraPose {
  position: Vec3;
  target: Vec3;
  fov: number;
}

export interface ScreenPoint {
  /** Pixel x within the canvas (0 = left edge). */
  x: number;
  /** Pixel y within the canvas (0 = top edge). */
  y: number;
  /** True when the world point sits behind the camera (do not render). */
  behind: boolean;
}

/**
 * Build a world→screen projector for a camera pose + canvas size, mirroring the
 * exact camera the <Canvas> renders with so DOM overlays land on the same pixels
 * as the WebGL scene. Reuses one PerspectiveCamera across all points.
 */
export function makeProjector(
  pose: CameraPose,
  width: number,
  height: number,
): (world: Vec3) => ScreenPoint {
  const cam = new PerspectiveCamera(pose.fov, width <= 0 || height <= 0 ? 1 : width / height, 0.1, 1000);
  cam.position.set(pose.position[0], pose.position[1], pose.position[2]);
  cam.lookAt(new Vector3(pose.target[0], pose.target[1], pose.target[2]));
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  const v = new Vector3();
  return (world: Vec3): ScreenPoint => {
    v.set(world[0], world[1], world[2]).project(cam);
    return {
      x: (v.x * 0.5 + 0.5) * width,
      y: (-v.y * 0.5 + 0.5) * height,
      // project() pushes points behind the camera outside the [-1,1] depth range.
      behind: v.z > 1,
    };
  };
}

/** Convenience single-point projection. */
export function projectToScreen(world: Vec3, pose: CameraPose, width: number, height: number): ScreenPoint {
  return makeProjector(pose, width, height)(world);
}
