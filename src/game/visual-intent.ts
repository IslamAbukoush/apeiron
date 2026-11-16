export function isVisualRequest(request:string){
  return /\b(see|look|view|picture|screenshot|scene|point\w*|this|that|here|there|colou?r|wear\w*|visible|front|behind|left|right|surround\w*|describe|ground|sky|around|under|above|beside|nearby|notice|observe|recognize|identify)\b/i.test(request);
}
