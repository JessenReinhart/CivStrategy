export const ISO_ANGLE = 26.565; 

export const toIso = (x: number, y: number): { x: number, y: number } => {
  return {
    x: x - y,
    y: (x + y) * 0.5
  };
};

export const toCartesian = (isoX: number, isoY: number): { x: number, y: number } => {
  return {
    x: isoY + isoX * 0.5,
    y: isoY - isoX * 0.5
  };
};