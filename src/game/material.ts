import RAPIER from '@dimforge/rapier2d-compat';

/** One material for every rigid contact. Fixture damping is its friction. */
export type Material = {
  restitution: number;
  friction: number;
  damping: number;
};

/** Static board. Rapier has no separate contact damping, so damping equals friction. */
export function fixtureMaterial(restitution: number, friction: number): Material {
  return { restitution, friction, damping: friction };
}

type FixtureTarget = {
  setRestitution(value: number): unknown;
  setFriction(value: number): unknown;
  setRestitutionCombineRule(rule: RAPIER.CoefficientCombineRule): unknown;
  setFrictionCombineRule(rule: RAPIER.CoefficientCombineRule): unknown;
};

/** Fixture numbers win over the ball because Max outranks Average. */
export function applyFixture(target: FixtureTarget, material: Material): void {
  const max = RAPIER.CoefficientCombineRule.Max;
  target.setRestitution(material.restitution);
  target.setFriction(material.friction);
  target.setRestitutionCombineRule(max);
  target.setFrictionCombineRule(max);
}

/** Ball contacts that do not hit a fixture. Air damping is the body's linear damping. */
export function applyBall(body: RAPIER.RigidBody, collider: RAPIER.Collider, material: Material): void {
  const average = RAPIER.CoefficientCombineRule.Average;
  collider.setRestitution(material.restitution);
  collider.setFriction(material.friction);
  collider.setRestitutionCombineRule(average);
  collider.setFrictionCombineRule(average);
  body.setLinearDamping(material.damping);
}
