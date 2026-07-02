"use client";

import { Merge, Pencil } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function PeopleEditor({
  people,
  onRename,
}: {
  people: string[];
  onRename: (currentName: string, nextName: string) => void;
}) {
  const [selectedSource, setSelectedSource] = useState(people[0] ?? "");
  const [selectedTarget, setSelectedTarget] = useState(people[1] ?? "");
  const source = people.includes(selectedSource)
    ? selectedSource
    : (people[0] ?? "");
  const availableTargets = people.filter((person) => person !== source);
  const target = availableTargets.includes(selectedTarget)
    ? selectedTarget
    : (availableTargets[0] ?? "");

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-md border p-4">
        <div>
          <p className="text-sm font-medium">Merge duplicate people</p>
          <p className="text-muted-foreground text-xs">
            All references to the duplicate will use the selected person.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div className="space-y-2">
            <Label>Duplicate</Label>
            <Select
              value={source}
              onValueChange={setSelectedSource}
              disabled={people.length < 2}
            >
              <SelectTrigger aria-label="Duplicate person">
                <SelectValue placeholder="Select duplicate" />
              </SelectTrigger>
              <SelectContent>
                {people.map((person) => (
                  <SelectItem key={person} value={person}>
                    {person}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Keep as</Label>
            <Select
              value={target}
              onValueChange={setSelectedTarget}
              disabled={people.length < 2}
            >
              <SelectTrigger aria-label="Person to keep">
                <SelectValue placeholder="Select person to keep" />
              </SelectTrigger>
              <SelectContent>
                {availableTargets.map((person) => (
                  <SelectItem key={person} value={person}>
                    {person}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => onRename(source, target)}
            disabled={!source || !target}
          >
            <Merge />
            Merge
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <p className="text-sm font-medium">Rename people</p>
          <p className="text-muted-foreground text-xs">
            Renaming updates every structured reference to that person.
          </p>
        </div>
        {people.length > 0 ? (
          <div className="space-y-2">
            {people.map((person) => (
              <PersonNameEditor
                key={person}
                person={person}
                onRename={onRename}
              />
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">No people found.</p>
        )}
      </div>
    </div>
  );
}

function PersonNameEditor({
  person,
  onRename,
}: {
  person: string;
  onRename: (currentName: string, nextName: string) => void;
}) {
  const [name, setName] = useState(person);
  const nextName = name.trim();

  return (
    <div className="flex gap-2">
      <Input
        value={name}
        onChange={(event) => setName(event.target.value)}
        aria-label={`Rename ${person}`}
      />
      <Button
        type="button"
        variant="outline"
        onClick={() => onRename(person, nextName)}
        disabled={!nextName || nextName === person}
      >
        <Pencil />
        Rename
      </Button>
    </div>
  );
}
