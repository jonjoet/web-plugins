// Chooses the assembly a new search defaults to: the first preferred name
// (the view the command was opened from, then other open views) that is a
// loaded assembly, otherwise the first assembly. Never mixes assemblies.
export function pickAssembly(assemblyNames, preferred = []) {
  for (const name of preferred) {
    if (name && assemblyNames.includes(name)) return name;
  }
  return assemblyNames[0];
}
